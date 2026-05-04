function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function compactValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function rowEntries(row) {
  if (!row || typeof row !== 'object') return [['value', row]];
  const flat = {};
  for (const [key, value] of Object.entries(row)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        flat[`${key}.${nestedKey}`] = nestedValue;
      }
    } else {
      flat[key] = value;
    }
  }
  return Object.entries(flat);
}

function renderTable(container, title, rows = []) {
  if (!container) return;
  const items = Array.isArray(rows) ? rows : rows?.items || [];
  if (!items.length) {
    container.innerHTML = `
      <section class="admin-table-card">
        <h3>${escapeHtml(title)}</h3>
        <div class="admin-empty">No data</div>
      </section>
    `;
    return;
  }

  const headers = rowEntries(items[0]).slice(0, 8).map(([key]) => key);
  const body = items.map((row) => {
    const map = Object.fromEntries(rowEntries(row));
    return `<tr>${headers.map((key) => `<td>${escapeHtml(compactValue(map[key]))}</td>`).join('')}</tr>`;
  }).join('');

  container.innerHTML = `
    <section class="admin-table-card">
      <h3>${escapeHtml(title)}</h3>
      <div class="admin-table-scroll">
        <table>
          <thead><tr>${headers.map((key) => `<th>${escapeHtml(key)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>
  `;
}

function getPageItems(page) {
  return Array.isArray(page?.items) ? page.items : [];
}

function withdrawalCanReview(status) {
  return status === 'pending';
}

function withdrawalCanClose(status) {
  return ['pending', 'under_review', 'approved_manual'].includes(status);
}

function firstUserId(usersPage) {
  const first = getPageItems(usersPage)[0];
  return first?.user?.id || first?.id || '';
}

function adminErrorMessage(error) {
  if (error?.status === 404 || error?.code === 'admin_disabled') return 'Admin panel is disabled or not found.';
  if (error?.status === 401 || error?.code === 'admin_unauthorized') return 'Admin authorization required.';
  if (error?.status === 403 || error?.code === 'admin_not_configured') return 'Admin access is not configured.';
  return 'Admin data is unavailable.';
}

export function createAdminController({ elements = {}, api, createIdempotencyKey = null, getDocument = () => document }) {
  let initialized = false;
  let loading = false;
  let actionLoading = false;

  function setStatus(message, type = 'info') {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.type = type;
  }

  async function load() {
    if (loading) return;
    loading = true;
    setStatus('Loading admin debug data...', 'loading');
    try {
      const query = elements.searchInput?.value?.trim() || '';
      const [usersPage, paymentOrders, withdrawals, auditLogs] = await Promise.all([
        api.getAdminUsers({ query, limit: 25 }),
        api.getAdminPaymentOrders({ limit: 25 }),
        api.getAdminWithdrawals({ limit: 25 }),
        api.getAdminAuditLogs({ limit: 25 })
      ]);

      renderTable(elements.users, 'Users', usersPage.items || []);
      renderTable(elements.payments, 'Payment orders', paymentOrders.items || []);
      renderTable(elements.withdrawals, 'Withdrawals', withdrawals.items || []);
      renderWithdrawals(withdrawals.items || []);
      renderTable(elements.auditLogs, 'Audit logs', auditLogs.items || []);

      const userId = firstUserId(usersPage);
      if (userId) {
        const [user, ledger, tasks, referrals] = await Promise.all([
          api.getAdminUser(userId),
          api.getAdminUserLedger(userId, { limit: 25 }),
          api.getAdminUserTasks(userId, { limit: 25 }),
          api.getAdminUserReferrals(userId, { limit: 25 })
        ]);
        renderTable(elements.userDetail, 'Selected user', [user]);
        renderTable(elements.ledger, 'Ledger events', ledger.items || []);
        renderTable(elements.tasks, 'User tasks', tasks.items || []);
        renderTable(elements.referrals, 'Referrals', referrals.items || []);
      } else {
        renderTable(elements.userDetail, 'Selected user', []);
        renderTable(elements.ledger, 'Ledger events', []);
        renderTable(elements.tasks, 'User tasks', []);
        renderTable(elements.referrals, 'Referrals', []);
      }

      setStatus('Read-only admin debug view. No write actions are available.', 'ready');
    } catch (error) {
      setStatus(adminErrorMessage(error), error?.status === 404 ? 'hidden' : 'error');
      [
        elements.users,
        elements.userDetail,
        elements.ledger,
        elements.payments,
        elements.tasks,
        elements.referrals,
        elements.withdrawals,
        elements.auditLogs
      ].forEach((container) => {
        if (container) container.innerHTML = '';
      });
    } finally {
      loading = false;
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    elements.refreshBtn?.addEventListener('click', () => load());
    elements.searchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') load();
    });
    elements.withdrawals?.addEventListener?.('click', (event) => {
      const button = event.target?.closest?.('[data-admin-withdrawal-action]');
      if (!button) return;
      handleWithdrawalAction(button.dataset.adminWithdrawalAction, button.dataset.withdrawalId);
    });
  }

  function makeIdempotencyKey(prefix) {
    if (typeof createIdempotencyKey === 'function') return createIdempotencyKey(prefix);
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}:${random}`;
  }

  function renderWithdrawals(items) {
    if (!elements.withdrawals) return;
    if (!items.length) {
      renderTable(elements.withdrawals, 'Withdrawals', []);
      return;
    }

    const rows = items.map((row) => {
      const id = row.id || row.withdrawal?.id || '';
      const status = row.status || row.withdrawal?.status || '';
      const userId = row.userId || row.withdrawal?.userId || '';
      const amountUnits = row.amountUnits || row.withdrawal?.amountUnits || '';
      const destinationWallet = row.destinationWallet || row.withdrawal?.destinationWallet || '';
      const actions = [
        withdrawalCanReview(status)
          ? `<button class="admin-mini-btn" data-admin-withdrawal-action="review" data-withdrawal-id="${escapeHtml(id)}">Review</button>`
          : '',
        withdrawalCanClose(status)
          ? `<button class="admin-mini-btn admin-mini-btn-danger" data-admin-withdrawal-action="reject" data-withdrawal-id="${escapeHtml(id)}">Reject</button>`
          : '',
        withdrawalCanClose(status)
          ? `<button class="admin-mini-btn admin-mini-btn-ok" data-admin-withdrawal-action="paid" data-withdrawal-id="${escapeHtml(id)}">Paid external</button>`
          : '',
        `<button class="admin-mini-btn" data-admin-withdrawal-action="detail" data-withdrawal-id="${escapeHtml(id)}">Details</button>`
      ].filter(Boolean).join('');

      return `
        <tr>
          <td>${escapeHtml(id)}</td>
          <td>${escapeHtml(status)}</td>
          <td>${escapeHtml(userId)}</td>
          <td>${escapeHtml(amountUnits)}</td>
          <td>${escapeHtml(destinationWallet)}</td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');

    elements.withdrawals.innerHTML = `
      <section class="admin-table-card">
        <h3>Withdrawals</h3>
        <div class="admin-table-scroll">
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>status</th>
                <th>user</th>
                <th>amount</th>
                <th>destination</th>
                <th>actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  async function openConfirmModal({ title, message, label, required = false }) {
    const doc = getDocument();
    if (!doc?.createElement) {
      const fallback = globalThis.prompt?.(`${title}\n${message}`, '');
      if (required && !String(fallback || '').trim()) return null;
      return String(fallback || '').trim();
    }

    return new Promise((resolve) => {
      const overlay = doc.createElement('div');
      overlay.className = 'admin-confirm-overlay';
      overlay.innerHTML = `
        <div class="admin-confirm-modal" role="dialog" aria-modal="true">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
          <label>${escapeHtml(label)}</label>
          <textarea class="admin-confirm-input" rows="4"></textarea>
          <div class="admin-confirm-error" hidden>${required ? 'This field is required.' : ''}</div>
          <div class="admin-confirm-actions">
            <button type="button" class="admin-mini-btn" data-admin-confirm="cancel">Cancel</button>
            <button type="button" class="admin-mini-btn admin-mini-btn-ok" data-admin-confirm="ok">Confirm</button>
          </div>
        </div>
      `;

      const close = (value) => {
        overlay.remove();
        resolve(value);
      };
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay || event.target?.dataset?.adminConfirm === 'cancel') {
          close(null);
          return;
        }
        if (event.target?.dataset?.adminConfirm === 'ok') {
          const input = overlay.querySelector('.admin-confirm-input');
          const value = String(input?.value || '').trim();
          if (required && !value) {
            const error = overlay.querySelector('.admin-confirm-error');
            if (error) error.hidden = false;
            input?.focus?.();
            return;
          }
          close(value);
        }
      });
      doc.body.appendChild(overlay);
      overlay.querySelector('.admin-confirm-input')?.focus?.();
    });
  }

  async function handleWithdrawalAction(action, id) {
    if (!id || actionLoading) return;
    actionLoading = true;
    try {
      if (action === 'detail') {
        const detail = await api.getAdminWithdrawal(id);
        renderTable(elements.userDetail, `Withdrawal ${id}`, [detail]);
        setStatus(`Loaded withdrawal ${id}`, 'ready');
        return;
      }

      if (action === 'review') {
        const note = await openConfirmModal({
          title: 'Mark withdrawal under review',
          message: 'This only changes manual review status. It does not send blockchain transactions.',
          label: 'Optional note'
        });
        if (note === null) return;
        await api.markAdminWithdrawalUnderReview({
          id,
          note,
          idempotencyKey: makeIdempotencyKey(`admin-withdrawal-review-${id}`)
        });
      }

      if (action === 'reject') {
        const reason = await openConfirmModal({
          title: 'Reject withdrawal',
          message: 'Write a clear reason for the audit log. No balance is silently changed.',
          label: 'Reject reason',
          required: true
        });
        if (reason === null) return;
        await api.rejectAdminWithdrawal({
          id,
          reason,
          idempotencyKey: makeIdempotencyKey(`admin-withdrawal-reject-${id}`)
        });
      }

      if (action === 'paid') {
        const note = await openConfirmModal({
          title: 'Mark paid externally',
          message: 'Use only after an operator completed payout outside this app. No blockchain call will be made here.',
          label: 'External payment note/reference',
          required: true
        });
        if (note === null) return;
        await api.markAdminWithdrawalPaidExternal({
          id,
          note,
          idempotencyKey: makeIdempotencyKey(`admin-withdrawal-paid-${id}`)
        });
      }

      setStatus('Withdrawal status updated. No automatic payout was performed.', 'ready');
      await load();
    } catch (error) {
      setStatus(error?.message || 'Withdrawal action failed.', 'error');
    } finally {
      actionLoading = false;
    }
  }

  return { init, load };
}
