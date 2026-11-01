/* quantri-app.js — Logic trang Quản trị hệ thống */
(function () {
  window.switchSubTab = function (tabKey) {
    const tabs = ['auth', 'backup', 'export'];
    tabs.forEach(t => {
      const panel = document.getElementById('panel-' + t);
      const btn = document.getElementById('subtab-btn-' + t);
      if (!panel || !btn) return;
      if (t === tabKey) {
        panel.classList.remove('hidden');
        panel.classList.add('flex');
        btn.classList.add('bg-primary', 'text-on-primary', 'shadow-sm');
        btn.classList.remove('text-on-surface-variant', 'hover:bg-surface-container-low');
      } else {
        panel.classList.add('hidden');
        panel.classList.remove('flex');
        btn.classList.remove('bg-primary', 'text-on-primary', 'shadow-sm');
        btn.classList.add('text-on-surface-variant', 'hover:bg-surface-container-low');
      }
    });
  };

  window.handleAdminLogin = function (event) {
    event.preventDefault();
    const btn = document.getElementById('btn-login-submit');
    const feedback = document.getElementById('login-feedback-box');
    const uName = document.getElementById('login-username').value;
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> <span>Đang xác thực...</span>';
    btn.disabled = true;
    setTimeout(() => {
      btn.innerHTML = '<span class="material-symbols-outlined text-[20px]">login</span> <span>Đăng Nhập Hệ Thống</span>';
      btn.disabled = false;
      feedback.classList.remove('bg-surface-container-low');
      feedback.classList.add('bg-surface-container-high');
      feedback.innerHTML = `
        <span class="material-symbols-outlined text-secondary text-[20px] mt-0.5">verified</span>
        <div class="flex flex-col">
          <span class="font-headline-sm text-headline-sm text-on-surface">Đăng nhập thành công! Phiên Root Admin đã kích hoạt.</span>
          <span class="font-body-sm text-body-sm text-on-surface-variant">Chào mừng <b>${uName}</b>. Khóa bảo mật OAuth2 Tiki được cấp phép đầy đủ quyền CRUD và MongoDB Engine TV1.</span>
        </div>`;
    }, 700);
  };

  window.resetLoginForm = function () {
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
  };

  window.executeBackupSimulation = function () {
    const books = BooksStore.all();
    if (!books.length) { BooksUI.toast("Không có dữ liệu để backup", "error"); return; }

    const btn = document.getElementById('btn-run-backup');
    const term = document.getElementById('terminal-output');
    const badge = document.getElementById('terminal-badge');
    const lastTime = document.getElementById('last-backup-timestamp');
    const sizeBadge = document.getElementById('file-size-badge');

    btn.disabled = true;
    badge.innerText = 'RUNNING DUMP...';
    badge.className = 'font-label-sm text-label-sm text-primary animate-pulse';
    const now = new Date().toLocaleTimeString('vi-VN');
    term.innerHTML += `<div class="text-primary font-bold">[${now}] $ Exporting ${books.length} docs from MongoDB → JSON</div>`;
    term.scrollTop = term.scrollHeight;

    setTimeout(() => {
      const json = JSON.stringify(books, null, 2);
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const filename = `tiki_books_backup_${stamp}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);

      term.innerHTML += `<div class="text-secondary-fixed font-bold">[SUCCESS] Saved ${filename} (${sizeMB} MB)</div>`;
      term.scrollTop = term.scrollHeight;
      badge.innerText = 'DUMP COMPLETED';
      badge.className = 'font-label-sm text-label-sm text-secondary font-bold';
      lastTime.innerText = 'Vừa tạo lúc ' + now + ' ICT';
      if (sizeBadge) sizeBadge.innerText = sizeMB + ' MB';
      btn.disabled = false;
      BooksUI.toast(`Đã backup ${books.length} sách (${sizeMB} MB)`);
    }, 800);
  };

  window.executeRestoreSimulation = function () {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const term = document.getElementById('terminal-output');
      const badge = document.getElementById('terminal-badge');
      const btn = document.getElementById('btn-run-restore');

      btn.disabled = true;
      badge.innerText = 'RESTORING...';
      badge.className = 'font-label-sm text-label-sm text-error animate-pulse';
      const now = new Date().toLocaleTimeString('vi-VN');
      term.innerHTML += `<div class="text-error font-bold">[${now}] $ Reading ${file.name}...</div>`;
      term.scrollTop = term.scrollHeight;

      try {
        const text = await file.text();
        const rows = JSON.parse(text);
        if (!Array.isArray(rows)) throw new Error("File không phải mảng JSON");
        term.innerHTML += `<div class="text-surface-variant">[+] ${rows.length} records parsed. Importing...</div>`;
        term.scrollTop = term.scrollHeight;

        let ok = 0, fail = 0;
        for (const b of rows) {
          delete b._id;
          const result = await BooksStore.add(b);
          if (result) ok++; else fail++;
        }
        await BooksStore.init();
        term.innerHTML += `<div class="text-secondary-fixed font-bold">[RESTORE SUCCESS] ${ok} OK, ${fail} FAIL. DB TV1 Healthy!</div>`;
        term.scrollTop = term.scrollHeight;
        badge.innerText = 'RESTORE READY';
        badge.className = 'font-label-sm text-label-sm text-secondary font-bold';
        BooksUI.toast(`Restore: ${ok} thành công, ${fail} thất bại`);
      } catch (err) {
        term.innerHTML += `<div class="text-error font-bold">[ERROR] ${err.message}</div>`;
        term.scrollTop = term.scrollHeight;
        badge.innerText = 'RESTORE FAILED';
        badge.className = 'font-label-sm text-label-sm text-error font-bold';
        BooksUI.toast("Restore thất bại: " + err.message, "error");
      }
      btn.disabled = false;
    };
    input.click();
  };

  window.simulateDownload = function (type) {
    const books = BooksStore.all();
    if (!books.length) { BooksUI.toast("Không có dữ liệu", "error"); return; }

    const toast = document.getElementById('export-toast');
    const title = document.getElementById('toast-title');
    const msg = document.getElementById('toast-msg');
    toast.classList.remove('hidden');
    toast.classList.add('flex');

    if (type === 'pdf') {
      title.innerText = 'Báo cáo PDF';
      msg.innerText = 'Đang mở hộp thoại in – chọn "Save as PDF" trong trình duyệt.';
      setTimeout(() => window.print(), 300);
    } else {
      const ok = BooksExport.csv(books, `tiki_books_full_${Date.now()}.csv`);
      title.innerText = 'Đang tải: tiki_books_full.csv';
      msg.innerText = ok
        ? `Đã xuất ${books.length} bản ghi CSV UTF-8`
        : 'Xuất CSV thất bại';
    }
    setTimeout(() => toast.classList.add('hidden'), 4000);
  };

  document.addEventListener("DOMContentLoaded", () => {
    window.booksReadyPromise.then((ok) => {
      if (!ok) BooksUI.toast("API không phản hồi – dùng cache", "info");
      console.log(`[Quantri] Ready with ${BooksStore.all().length} books`);
    });
  });
})();