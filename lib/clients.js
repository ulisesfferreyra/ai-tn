// lib/clients.js
// Configuración de clientes autorizados

// En producción, esto debería estar en una base de datos
// Por ahora, usamos variables de entorno o hardcoded

export const AUTHORIZED_CLIENTS = {
  'starconcept': {
    domain: 'starconcept.co',
    password: process.env.CLIENT_STARCONCEPT_PASSWORD || 'star2024',
    name: 'Star Concept',
  },
  // Agregar más clientes aquí:
  // 'otratienda': {
  //   domain: 'otratienda.com',
  //   password: process.env.CLIENT_OTRATIENDA_PASSWORD || 'password123',
  //   name: 'Otra Tienda',
  // },
};

export function validateClient(username, password) {
  const client = AUTHORIZED_CLIENTS[username.toLowerCase()];
  if (!client) return null;
  if (client.password !== password) return null;
  return {
    username: username.toLowerCase(),
    domain: client.domain,
    name: client.name,
  };
}

export function getClientByDomain(domain) {
  const cleanDomain = domain.replace('www.', '');
  for (const [username, client] of Object.entries(AUTHORIZED_CLIENTS)) {
    if (client.domain === cleanDomain) {
      return { username, ...client };
    }
  }
  return null;
}
