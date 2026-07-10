// Render HTML de la factura (para email y vista web).
// v2: PDF adjunto vía html-pdf-node o puppeteer; el HTML ya es imprimible.

function eur(n) {
  return Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

function renderFacturaHtml(f, comercio) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Factura ${f.numero}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; max-width: 720px; margin: 24px auto; padding: 0 16px; }
  header { display: flex; justify-content: space-between; border-bottom: 3px solid #0e7490; padding-bottom: 12px; }
  h1 { font-size: 20px; margin: 0; color: #0e7490; }
  .num { text-align: right; font-size: 14px; }
  .partes { display: flex; gap: 24px; margin: 20px 0; font-size: 13px; }
  .partes div { flex: 1; background: #f4f7f8; padding: 12px; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
  td.n, th.n { text-align: right; }
  .totales { margin-top: 8px; margin-left: auto; width: 260px; font-size: 13px; }
  .totales div { display: flex; justify-content: space-between; padding: 4px 10px; }
  .totales .total { font-weight: bold; font-size: 15px; border-top: 2px solid #0e7490; }
  footer { margin-top: 28px; font-size: 11px; color: #667; }
  @media print { body { margin: 0; } }
</style></head><body>
<header>
  <div><h1>FACTURA</h1><div>${comercio.nombre}</div></div>
  <div class="num"><strong>Nº ${f.numero}</strong><br>Fecha: ${f.fecha_emision}${f.ticket_ref ? `<br>Ticket: ${f.ticket_ref}` : ''}</div>
</header>
<div class="partes">
  <div><strong>Emisor</strong><br>${comercio.nombre}<br>NIF: ${comercio.nif}<br>${comercio.direccion}</div>
  <div><strong>Cliente</strong><br>${escapeHtml(f.cliente_nombre)}<br>NIF: ${f.cliente_nif}${f.cliente_direccion ? `<br>${escapeHtml(f.cliente_direccion)}` : ''}</div>
</div>
<table>
  <thead><tr><th>Concepto</th><th class="n">Base</th><th class="n">IVA</th><th class="n">Total</th></tr></thead>
  <tbody><tr>
    <td>${escapeHtml(f.concepto)}</td>
    <td class="n">${eur(f.base_imponible)}</td>
    <td class="n">${f.tipo_iva}%</td>
    <td class="n">${eur(f.total)}</td>
  </tr></tbody>
</table>
<div class="totales">
  <div><span>Base imponible</span><span>${eur(f.base_imponible)}</span></div>
  <div><span>IVA (${f.tipo_iva}%)</span><span>${eur(f.cuota_iva)}</span></div>
  <div class="total"><span>Total</span><span>${eur(f.total)}</span></div>
</div>
<footer>Factura emitida a través de TicketFactura en nombre de ${comercio.nombre}. Conserva este documento a efectos fiscales.</footer>
</body></html>`;
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

module.exports = { renderFacturaHtml };
