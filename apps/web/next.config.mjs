/** @type {import('next').NextConfig} */
const nextConfig = {
  // The store and the executor are Node-only; keep them out of any bundle.
  serverExternalPackages: ['@ghostapi/store', '@ghostapi/executor', '@ghostapi/core'],
};

export default nextConfig;
