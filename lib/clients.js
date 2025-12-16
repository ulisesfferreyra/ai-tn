// lib/clients.js
// Configuración de clientes autorizados para el dashboard

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

// Validar credenciales de un cliente
export function validateClient(username, password) {
  const client = AUTHORIZED_CLIENTS[username?.toLowerCase()];
  if (!client) {
    return { valid: false, error: 'Client not found' };
  }
  
  if (client.password !== password) {
    return { valid: false, error: 'Invalid password' };
  }
  
  return { 
    valid: true, 
    client: {
      username: username.toLowerCase(),
      domain: client.domain,
      name: client.name,
    }
  };
}

// Obtener cliente por dominio
export function getClientByDomain(domain) {
  const normalizedDomain = domain?.replace(/^www\./, '').toLowerCase();
  
  for (const [username, client] of Object.entries(AUTHORIZED_CLIENTS)) {
    if (client.domain === normalizedDomain) {
      return { username, ...client };
    }
  }
  
  return null;
}

