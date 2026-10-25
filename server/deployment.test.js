import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deploymentConfig,publicCapabilities} from './deployment.js';

test('Render chooses a public web bind and only its exact configured hostnames',()=>{
  const config=deploymentConfig({RENDER:'true',PORT:'10000',RENDER_EXTERNAL_HOSTNAME:'mother-example.onrender.com',RENDER_EXTERNAL_URL:'https://mother-example.onrender.com',MOTHER_ALLOWED_HOSTS:'demo.example.com'});
  assert.equal(config.host,'0.0.0.0');assert.equal(config.port,10000);assert.equal(config.mode,'hosted-preview');
  assert.deepEqual(config.allowedHosts,['demo.example.com','mother-example.onrender.com']);
});
test('desktop session and local development retain their local behavior',()=>{
  assert.equal(deploymentConfig({RENDER:'true'},'private-session').mode,'desktop');
  assert.equal(deploymentConfig({RENDER:'false'}).mode,'local');
  assert.equal(deploymentConfig({}).host,'127.0.0.1');
  assert.equal(deploymentConfig({MOTHER_MODE:'hosted-preview'}).host,'0.0.0.0');
  assert.throws(()=>deploymentConfig({PORT:'invalid'}),/PORT/);
});
test('hosted preview advertises only browser-local functionality',()=>{
  assert.deepEqual(publicCapabilities('hosted-preview'),{localTools:true,modelSetup:false,projectAccess:false,appGrants:false,datasetLinks:false,securityBridge:false,neuralChat:false});
  assert.equal(publicCapabilities('desktop').projectAccess,true);
});
