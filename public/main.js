(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Tabs
  $$("nav button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$("nav button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$("main .tab").forEach((s) => s.classList.remove("active"));
      $(`#${btn.dataset.tab}`).classList.add("active");
    });
  });

  // History
  async function loadHistory() {
    const q = encodeURIComponent($("#history-q").value || "");
    const url = q ? `/api/history?q=${q}` : "/api/history";
    const res = await fetch(url);
    const data = await res.json();
    const tbody = $("#history-table tbody");
    tbody.innerHTML = "";
    (data.entries || []).forEach((e) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${new Date(e.timestamp).toLocaleString()}</td>
        <td title="${e.command}">${e.command}</td>
        <td>${e.output_summary || e.execution_status || ''}</td>
        <td>${e.working_directory || ''}</td>
        <td>${e.safety_classification || ''}</td>`;
      tbody.appendChild(tr);
    });
  }

  $("#history-refresh").addEventListener("click", loadHistory);
  $("#history-q").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") loadHistory();
  });

  // Executions
  async function loadExecutions() {
    const q = encodeURIComponent($("#exec-q").value || "");
    const st = encodeURIComponent($("#exec-status").value);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (st && st !== 'all') params.set("status", st);
    const res = await fetch(`/api/executions${params.size ? `?${params}` : ''}`);
    const data = await res.json();
    const tbody = $("#exec-table tbody");
    tbody.innerHTML = "";
    (data.processes || []).forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${p.execution_id}</td>
        <td title="${p.command}">${p.command}</td>
        <td>${p.status}</td>
        <td>${p.execution_time_ms ?? ''}</td>
        <td>${p.output_id ?? ''}</td>`;
      tbody.appendChild(tr);
    });
  }

  $("#exec-refresh").addEventListener("click", loadExecutions);
  $("#exec-q").addEventListener("keydown", (ev) => { if (ev.key === "Enter") loadExecutions(); });

  // Terminals
  async function loadTerminals() {
    const st = encodeURIComponent($("#term-status").value);
    const params = new URLSearchParams();
    if (st && st !== 'all') params.set("status", st);
    const res = await fetch(`/api/terminals${params.size ? `?${params}` : ''}`);
    const data = await res.json();
    const tbody = $("#term-table tbody");
    tbody.innerHTML = "";
    (data.terminals || []).forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${t.terminal_id}</td>
        <td>${t.session_name || ''}</td>
        <td>${t.status}</td>
        <td>${t.last_activity || ''}</td>`;
      tbody.appendChild(tr);
    });
  }

  $("#term-refresh").addEventListener("click", loadTerminals);

  // Auto refresh on load
  loadHistory();
  loadExecutions();
  loadTerminals();
})();
