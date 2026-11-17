import { defineConfig } from 'vitest/config';

// Os testes rodam em Node, sem o plugin do Cloudflare: cobrem as regras de negócio e a API.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
