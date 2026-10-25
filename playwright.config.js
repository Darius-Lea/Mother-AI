import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',fullyParallel:false,workers:1,timeout:60000,
  use:{baseURL:'http://127.0.0.1:3100',viewport:{width:1440,height:1100},launchOptions:{executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']},screenshot:'only-on-failure'},
  webServer:{command:'npm run build && npm start',url:'http://127.0.0.1:3100/api/health',env:{PORT:'3100',MOTHER_DATA_DIR:'/tmp/mother-e2e-grants'},reuseExistingServer:false,timeout:60000},
});
