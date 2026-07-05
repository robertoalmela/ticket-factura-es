// Validación de NIF/NIE/CIF españoles (adaptado de copisteria-facturas).

const LETRAS_NIF = 'TRWAGMYFPDXBNJZSQVHLCKE';

function validarNIF(valor) {
  const v = String(valor || '').toUpperCase().replace(/[\s-]/g, '');

  // NIF: 8 dígitos + letra
  const nif = v.match(/^(\d{8})([A-Z])$/);
  if (nif) return LETRAS_NIF[Number(nif[1]) % 23] === nif[2];

  // NIE: X/Y/Z + 7 dígitos + letra
  const nie = v.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (nie) {
    const num = Number({ X: '0', Y: '1', Z: '2' }[nie[1]] + nie[2]);
    return LETRAS_NIF[num % 23] === nie[3];
  }

  // CIF: letra + 7 dígitos + dígito/letra de control
  const cif = v.match(/^([ABCDEFGHJKLMNPQRSUVW])(\d{7})([0-9A-J])$/);
  if (cif) {
    const digits = cif[2].split('').map(Number);
    let suma = 0;
    digits.forEach((d, i) => {
      if (i % 2 === 0) {
        const doble = d * 2;
        suma += doble > 9 ? doble - 9 : doble;
      } else {
        suma += d;
      }
    });
    const control = (10 - (suma % 10)) % 10;
    const letraControl = 'JABCDEFGHI'[control];
    return cif[3] === String(control) || cif[3] === letraControl;
  }

  return false;
}

function normalizarNIF(valor) {
  return String(valor || '').toUpperCase().replace(/[\s-]/g, '');
}

module.exports = { validarNIF, normalizarNIF };
