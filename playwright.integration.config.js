import base from './playwright.config.js';
import { defineConfig } from '@playwright/test';

export default defineConfig({ ...base, testDir: './tests/integration', workers: 1, timeout: 60000 });
