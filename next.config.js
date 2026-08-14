/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Template + student OMR images are uploaded through route handlers,
      // but keep the body limit generous for multipart form posts.
      bodySizeLimit: '8mb',
    },
  },
};

module.exports = nextConfig;
