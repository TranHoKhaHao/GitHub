/* saoluu-app.js — Backup & Restore (v3 - Fixed Operator Name) */
(function () {
  "use strict";
  const API = "http://localhost:5000"; 
  
  const $ = (id) => document.getElementById(id);
  const fmtDate = (d) => d ? new Date(d).toLocaleString("vi-VN") : "—";
  const fmtNum = (n) => new Intl.NumberFormat("vi-VN").format(n || 0);
  const fmtSize = (bytes) => {
    if (!bytes) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  };
  const escapeHtml = (s) => { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; };
  const getOperator = () => $("global-operator")?.value.trim() || "Admin Operator";

  let _selectedFile = null;

  async function safeFetch(endpoint, options = {}) {
    try {
      const res = await fetch(`${API}${endpoint}`, options);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (err) {
        throw new Error(`Server trả về lỗi (Mã HTTP: ${res.status}).`);
      }
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        throw new Error("Không thể kết nối đến Backend.");
      }
      throw error;
    }
  }

  function toast(message, type = "success") {
    let t = $("saoluu-toast");
    if (!t) { t = document.createElement("div"); t.id = "saoluu-toast"; document.body.appendChild(t); }
    const icons = { success: "check_circle", error: "error", info: "info" };
    const bgs   = { success: "bg-green-600", error: "bg-red-600", info: "bg-blue-600" };
    t.className = `fixed bottom-6 right-6 z-[1000] flex items-center gap-2 px-4 py-3 rounded-lg shadow-xl text-white font-medium transition-all ${bgs[type] || bgs.success}`;
    t.style.opacity = "1"; t.style.transform = "translateY(0)";
    t.innerHTML = `<span class="material-symbols-outlined">${icons[type] || icons.success}</span><span>${escapeHtml(message)}</span>`;
    setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(20px)"; }, 3000);
  }

  async function loadStats() {
    try {
      const d = await safeFetch("/api/backup/stats");
      if (!d.ok) throw new Error(d.error);
      $("stat-current-books").textContent = fmtNum(d.current_books);
      $("stat-total-backups").textContent = fmtNum(d.total_backups);
      $("stat-total-size").textContent    = d.total_size_mb;
      $("stat-last-restore").textContent  = d.last_restore ? fmtDate(d.last_restore) : "Chưa có";
    } catch (e) {
      $("stat-current-books").textContent = "—";
      $("stat-last-restore").textContent  = "Lỗi API";
    }
  }

  async function loadBackups() {
    const tbody = $("backup-tbody");
    try {
      const d = await safeFetch("/api/backup/list?limit=100");
      if (!d.backups || !d.backups.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-space-lg text-on-surface-variant">Chưa có bản sao lưu nào.</td></tr>`;
        return;
      }
      tbody.innerHTML = d.backups.map(b => {
        const typeMap = { manual: { label: "Thủ công", cls: "bg-blue-100 text-blue-700" }, snapshot: { label: "Tự động", cls: "bg-green-100 text-green-700" } };
        const tp = typeMap[b.type] || { label: b.type, cls: "bg-gray-100 text-gray-700" };
        return `
          <tr class="hover:bg-gray-50 border-b">
            <td class="py-3 px-4 font-mono text-[12px] font-bold text-blue-600 whitespace-nowrap">${escapeHtml(b.backup_id)}</td>
            <td class="py-3 px-4 whitespace-nowrap">${fmtDate(b.created_at)}</td>
            <td class="py-3 px-4"><span class="inline-block px-2 py-0.5 rounded text-[11px] font-bold ${tp.cls}">${tp.label}</span></td>
            <td class="py-3 px-4 text-right font-mono">${fmtNum(b.record_count)}</td>
            <td class="py-3 px-4 text-right font-mono whitespace-nowrap">${fmtSize(b.file_size)}</td>
            <td class="py-3 px-4 font-semibold text-gray-700">${escapeHtml(b.created_by || "—")}</td>
            <td class="py-3 px-4 max-w-[200px] truncate" title="${escapeHtml(b.note || "")}">${escapeHtml(b.note || "—")}</td>
            <td class="py-3 px-4">
              <div class="flex items-center justify-center gap-1">
                <button title="Tải JSON" class="p-1 hover:bg-gray-200 text-blue-600 rounded" onclick="SaoluuApp.download('${b.backup_id}')"><span class="material-symbols-outlined text-[18px]">download</span></button>
                <button title="Khôi phục" class="p-1 hover:bg-orange-100 text-orange-600 rounded" onclick="SaoluuApp.openRestoreModal('${b.backup_id}', ${b.record_count})"><span class="material-symbols-outlined text-[18px]">restore</span></button>
                <button title="Xoá" class="p-1 hover:bg-red-100 text-red-600 rounded" onclick="SaoluuApp.remove('${b.backup_id}')"><span class="material-symbols-outlined text-[18px]">delete</span></button>
              </div>
            </td>
          </tr>`;
      }).join("");
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-space-lg text-red-600 font-bold">⚠️ ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  async function loadRestoreHistory() {
    const tbody = $("restore-tbody");
    try {
      const d = await safeFetch("/api/backup/history?limit=30");
      const restores = (d.history || []).filter(h => h.type === "restore");
      if (!restores.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-space-lg text-gray-500">Chưa có lần phục hồi nào.</td></tr>`;
        return;
      }
      tbody.innerHTML = restores.map(h => `
        <tr class="hover:bg-gray-50 border-b">
          <td class="py-3 px-4 whitespace-nowrap">${fmtDate(h.created_at)}</td>
          <td class="py-3 px-4 font-semibold">${escapeHtml(h.created_by || "—")}</td>
          <td class="py-3 px-4 font-mono text-[12px]">${escapeHtml(h.source_backup_id || h.source_filename || "—")}</td>
          <td class="py-3 px-4 text-center">
            <span class="inline-block px-2 py-0.5 rounded text-[11px] font-bold ${h.mode === "replace" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}">
              ${h.mode === "replace" ? "Replace" : "Merge"}
            </span>
          </td>
          <td class="py-3 px-4 text-right font-mono">${fmtNum(h.inserted)}</td>
          <td class="py-3 px-4 text-right font-mono">${fmtNum(h.updated)}</td>
          <td class="py-3 px-4 text-center font-mono text-[11px] text-gray-500">${h.snapshot_id ? escapeHtml(h.snapshot_id) : "—"}</td>
        </tr>
      `).join("");
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-space-lg text-red-600">⚠️ ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  async function createBackup() {
    const btn  = $("btn-create-backup");
    const note = $("backup-note").value.trim();
    const op   = getOperator();

    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined text-[22px] animate-spin">progress_activity</span><span>ĐANG TẠO…</span>`;
    try {
      const d = await safeFetch("/api/backup/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, created_by: op }),
      });
      toast(`✅ Đã backup ${fmtNum(d.record_count)} SKU`);
      $("backup-note").value = "";
      await Promise.all([loadStats(), loadBackups(), loadRestoreHistory()]);
    } catch (e) {
      toast("❌ " + e.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span class="material-symbols-outlined text-[22px]">cloud_upload</span><span>TẠO BACKUP NGAY</span>`;
    }
  }

  async function uploadRestore() {
    if (!_selectedFile) { toast("Chưa chọn file", "error"); return; }
    const mode = document.querySelector('input[name="upload-mode"]:checked').value;
    const op   = getOperator();

    if (!confirm(`Khôi phục (${mode.toUpperCase()}) từ "${_selectedFile.name}"?\nNgười thực hiện: ${op}`)) return;

    const btn = $("btn-upload-restore");
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined text-[22px] animate-spin">progress_activity</span><span>ĐANG PHỤC HỒI…</span>`;

    try {
      const fd = new FormData();
      fd.append("file", _selectedFile);
      fd.append("mode", mode);
      fd.append("restored_by", op);  // Lấy tên từ ô input

      const d = await safeFetch("/api/backup/upload-restore", { method: "POST", body: fd });
      toast(`✅ Restore xong: +${d.inserted} mới, ~${d.updated} cập nhật`);
      resetDropZone();
      await Promise.all([loadStats(), loadBackups(), loadRestoreHistory()]);
    } catch (e) {
      toast("❌ " + e.message, "error");
    } finally {
      btn.disabled = true; 
      btn.innerHTML = `<span class="material-symbols-outlined text-[22px]">restore</span><span>PHỤC HỒI TỪ FILE</span>`;
    }
  }

  function resetDropZone() {
    _selectedFile = null;
    $("file-input").value = "";
    $("drop-zone-label").textContent = "Kéo thả file JSON vào đây hoặc bấm để chọn";
    $("btn-upload-restore").disabled = true;
  }

  function initDropZone() {
    const zone = $("drop-zone"), input = $("file-input"), label = $("drop-zone-label"), btn = $("btn-upload-restore");
    if(!zone) return;
    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      if (input.files.length) { _selectedFile = input.files[0]; label.textContent = `📄 ${_selectedFile.name}`; btn.disabled = false; }
    });
    ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("border-blue-500"); }));
    ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("border-blue-500"); }));
    zone.addEventListener("drop", (e) => {
      const files = e.dataTransfer.files;
      if (!files.length) return;
      if (!files[0].name.toLowerCase().endsWith(".json")) { toast("Chỉ nhận file .json", "error"); return; }
      _selectedFile = files[0]; label.textContent = `📄 ${_selectedFile.name}`; btn.disabled = false;
    });
  }

  function download(backupId) { window.open(`${API}/api/backup/download/${encodeURIComponent(backupId)}`, "_blank"); }
  
  async function remove(backupId) {
    if (!confirm(`Xoá backup "${backupId}"?`)) return;
    try {
      await safeFetch(`/api/backup/${encodeURIComponent(backupId)}`, { method: "DELETE" });
      toast(`🗑 Đã xoá`); await Promise.all([loadStats(), loadBackups()]);
    } catch (e) { toast("❌ " + e.message, "error"); }
  }

  function openRestoreModal(backupId, recordCount) {
    const op = getOperator();
    const mode = prompt(`Khôi phục từ: ${backupId}\n(${fmtNum(recordCount)} SKU)\nNgười thực hiện: ${op}\n\nNhập "replace" (Xoá hết) hoặc "merge" (Gộp):`, "replace");
    if (mode === null) return;
    const m = mode.trim().toLowerCase();
    if (m !== "merge" && m !== "replace") { toast("Sai cú pháp", "error"); return; }
    restore(backupId, m, op);
  }

  async function restore(backupId, mode, op) {
    try {
      const d = await safeFetch(`/api/backup/restore/${encodeURIComponent(backupId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, restored_by: op }),
      });
      toast(`✅ Restore (${mode}): +${d.inserted} mới, ~${d.updated} cập nhật`);
      await Promise.all([loadStats(), loadBackups(), loadRestoreHistory()]);
    } catch (e) { toast("❌ " + e.message, "error"); }
  }

  function bind() {
    $("btn-create-backup")?.addEventListener("click", createBackup);
    $("btn-upload-restore")?.addEventListener("click", uploadRestore);
    $("btn-refresh-backups")?.addEventListener("click", () => { toast("Đang làm mới…", "info"); loadStats(); loadBackups(); loadRestoreHistory(); });
  }

  window.SaoluuApp = { download, openRestoreModal, remove };

  document.addEventListener("DOMContentLoaded", () => {
    bind(); initDropZone(); loadStats(); loadBackups(); loadRestoreHistory();
  });
})();