(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Global state
  const state = {
    autoRefresh: false,
    history: { page: 1, totalPages: 1 },
    selectedHistoryId: null,
    selectedExecId: null,
    selectedTermId: null,
    timers: new Set(),
  };

  // Tabs
  $$("nav button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$("nav button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$("main .tab").forEach((s) => s.classList.remove("active"));
      $(`#${btn.dataset.tab}`).classList.add("active");
    });
  });

  // Auto refresh
  $("#auto-refresh").addEventListener("change", (e) => {
    state.autoRefresh = e.target.checked;
  });

  // History
  async function loadHistory(page = state.history.page) {
    const q = encodeURIComponent($("#history-q").value || "");
    const executed = $("#history-executed").value;
    const safety = $("#history-safety").value;
    const from = $("#history-from").value;
    const to = $("#history-to").value;
    const pageSize = $("#history-page-size").value || "20";
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (executed) params.set("executed", executed);
    if (safety) params.set("safety", safety);
    if (from) params.set("date_from", new Date(from).toISOString());
    if (to) params.set("date_to", new Date(to).toISOString());
    params.set("page", String(page));
    params.set("page_size", pageSize);
    const url = `/api/history?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json();
    const tbody = $("#history-table tbody");
    tbody.innerHTML = "";
    (data.entries || []).forEach((e) => {
      const tr = document.createElement("tr");
      tr.className = "clickable";
      tr.dataset.id = e.execution_id;
      tr.innerHTML = `<td>${new Date(e.timestamp).toLocaleString()}</td>
        <td title="${e.command}">${e.command}</td>
        <td>${e.output_summary || e.execution_status || ''}</td>
        <td>${e.working_directory || ''}</td>
        <td>${e.safety_classification || ''}</td>`;
      tbody.appendChild(tr);
    });
    state.history.page = data.pagination?.page || 1;
    state.history.totalPages = data.pagination?.total_pages || 1;
    $("#history-page-info").textContent = `${state.history.page} / ${state.history.totalPages}`;
    $$("#history-table tbody tr.clickable").forEach((tr) => {
      tr.addEventListener("click", async () => {
        state.selectedHistoryId = tr.dataset.id;
        await showHistoryDetail(state.selectedHistoryId);
      });
    });
  }

  $("#history-refresh").addEventListener("click", loadHistory);
  $("#history-prev").addEventListener("click", () => { if (state.history.page > 1) loadHistory(state.history.page - 1); });
  $("#history-next").addEventListener("click", () => { if (state.history.page < state.history.totalPages) loadHistory(state.history.page + 1); });
  $("#history-q").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") loadHistory();
  });
  ["#history-from", "#history-to", "#history-executed", "#history-safety", "#history-page-size"].forEach((id) => {
    $(id).addEventListener("change", () => loadHistory(1));
  });

  async function showHistoryDetail(id) {
    const panel = $("#history-detail");
    const pre = $("#history-detail-pre");
    const btnCopy = $("#history-copy-cmd");
    const closeBtn = $("#history-close-detail");
    panel.hidden = false;
    pre.textContent = "読み込み中...";
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(id)}`);
      const data = await res.json();
      const e = data.entry;
      pre.textContent = JSON.stringify(e, null, 2);
      btnCopy.onclick = async () => {
        try { await navigator.clipboard.writeText(e.command || ""); } catch {}
      };
      closeBtn.onclick = () => { panel.hidden = true; };
    } catch (err) {
      pre.textContent = String(err);
    }
  }

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
      tr.className = "clickable";
      tr.dataset.id = p.execution_id;
      tr.innerHTML = `<td>${p.execution_id}</td>
        <td title="${p.command}">${p.command}</td>
        <td>${p.status}</td>
        <td>${p.execution_time_ms ?? ''}</td>
        <td>${p.output_id ?? ''}</td>`;
      tbody.appendChild(tr);
    });
    $$("#exec-table tbody tr.clickable").forEach((tr) => {
      tr.addEventListener("click", async () => {
        state.selectedExecId = tr.dataset.id;
        await showExecDetail(state.selectedExecId);
      });
    });
  }

  $("#exec-refresh").addEventListener("click", loadExecutions);
  $("#exec-q").addEventListener("keydown", (ev) => { if (ev.key === "Enter") loadExecutions(); });

  async function showExecDetail(id) {
    const panel = $("#exec-detail");
    const pre = $("#exec-detail-pre");
    const closeBtn = $("#exec-close-detail");
    const list = $("#exec-outputs");
    panel.hidden = false;
    pre.textContent = "読み込み中...";
    list.innerHTML = "";
    try {
      const res = await fetch(`/api/executions/${encodeURIComponent(id)}`);
      const data = await res.json();
      pre.textContent = JSON.stringify(data, null, 2);
      const ores = await fetch(`/api/executions/${encodeURIComponent(id)}/outputs`);
      const odata = await ores.json();
      (odata.files || []).forEach((f) => {
        const li = document.createElement("li");
        li.textContent = `${f.type}: ${f.name} (${f.size}B)`;
        list.appendChild(li);
      });
      closeBtn.onclick = () => { panel.hidden = true; };
    } catch (err) {
      pre.textContent = String(err);
    }
  }

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
      tr.className = "clickable";
      tr.dataset.id = t.terminal_id;
      tr.innerHTML = `<td>${t.terminal_id}</td>
        <td>${t.session_name || ''}</td>
        <td>${t.status}</td>
        <td>${t.last_activity || ''}</td>`;
      tbody.appendChild(tr);
    });
    $$("#term-table tbody tr.clickable").forEach((tr) => {
      tr.addEventListener("click", async () => {
        state.selectedTermId = tr.dataset.id;
        await showTerminalOutput(state.selectedTermId);
      });
    });
  }

  $("#term-refresh").addEventListener("click", loadTerminals);

  async function showTerminalOutput(id) {
    const panel = $("#term-output-panel");
    const pre = $("#term-output-pre");
    const btnRefresh = $("#term-output-refresh");
    const btnClose = $("#term-output-close");
    const auto = $("#term-autorefresh");
    panel.hidden = false;
    async function refreshOnce() {
      try {
        const res = await fetch(`/api/terminals/${encodeURIComponent(id)}/output?line_count=300&include_ansi=false`);
        const data = await res.json();
        pre.textContent = (data.output || "").trimEnd();
        pre.scrollTop = pre.scrollHeight;
      } catch (e) {
        pre.textContent = String(e);
      }
    }
    btnRefresh.onclick = refreshOnce;
    btnClose.onclick = () => { panel.hidden = true; auto.checked = false; stopTimers(); };
    auto.onchange = () => { if (auto.checked) startAuto(); else stopTimers(); };
    await refreshOnce();
    function startAuto() {
      const t = setInterval(refreshOnce, 2000);
      state.timers.add(t);
    }
    function stopTimers() {
      for (const t of state.timers) clearInterval(t);
      state.timers.clear();
    }
  }

  // Auto refresh on load
  loadHistory();
  loadExecutions();
  loadTerminals();

  // Global auto refresh loop
  (async () => {
    while (true) {
      if (state.autoRefresh) {
        loadHistory(state.history.page);
        loadExecutions();
        loadTerminals();
      }
      await sleep(3000);
    }
  })();
})();
