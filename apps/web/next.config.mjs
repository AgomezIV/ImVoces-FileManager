/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Los paquetes del workspace se distribuyen como TS/ESM sin transpilar.
  transpilePackages: ['@imvoces/contracts'],
};

export default nextConfig;
