/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Permite importar código compartido fuera del root (ej: ../aws/src)
  experimental: {
    externalDir: true,
  },
};

module.exports = nextConfig;
