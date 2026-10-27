import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,testMatch:'catalogue.spec.ts',testIgnore:[],webServer:{command:'node --import tsx tests/serve.ts --dev',url:'http://127.0.0.1:4319',reuseExistingServer:false}});
