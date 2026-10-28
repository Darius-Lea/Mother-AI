import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const MODULE_ID='virtual:mother-vosk';
const NAMED_WRAPPER='function createNamedFunction(name,body){var fn=function(){return body.apply(this,arguments)};Object.defineProperty(fn,"name",{value:makeLegalFunctionName(name)});return fn}';
// Equivalent embind argument conversion without source-code generation. Keep
// the application's CSP strict; no page or worker needs unsafe-eval.
const INVOKER=`function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){
  var argCount=argTypes.length;
  if(argCount<2)throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
  var method=argTypes[1]!==null&&classType!==null;
  var needsStack=argTypes.slice(1).some(function(type){return type!==null&&type.destructorFunction===undefined});
  return function(){
    if(arguments.length!==argCount-2)throwBindingError('function '+humanName+' called with '+arguments.length+' arguments, expected '+(argCount-2)+' args!');
    var destructors=needsStack?[]:null,wired=[cppTargetFunc],converted=[],types=[];
    if(method){var thisWired=argTypes[1].toWireType(destructors,this);wired.push(thisWired);converted.push(thisWired);types.push(argTypes[1]);}
    for(var i=0;i<arguments.length;i++){var value=argTypes[i+2].toWireType(destructors,arguments[i]);wired.push(value);converted.push(value);types.push(argTypes[i+2]);}
    var result=cppInvokerFunc.apply(null,wired);
    if(needsStack)runDestructors(destructors);
    else for(var i=0;i<types.length;i++)if(types[i].destructorFunction!==null)types[i].destructorFunction(converted[i]);
    if(argTypes[0].name!=="void")return argTypes[0].fromWireType(result);
  }
}`;
const METHOD_CALLER=`function __emval_get_method_caller(argCount,argTypes){
  var types=__emval_lookupTypes(argCount,argTypes),retType=types[0];
  return __emval_addMethodCaller(function(handle,name,destructors,args){
    var values=[],offset=0;
    for(var i=1;i<argCount;i++){values.push(types[i].readValueFromPointer(args+offset));offset+=types[i].argPackAdvance;}
    var result=handle[name].apply(handle,values);
    for(var i=1;i<argCount;i++)if(types[i].deleteObject)types[i].deleteObject(values[i-1]);
    if(!retType.isVoid)return retType.toWireType(destructors,result);
  });
}`;

export function adaptVoskSource(source) {
  const match=source.match(/createBase64WorkerFactory\('([^']+)'/);
  if(!match)throw Error('Unrecognized Vosk worker distribution.');
  let worker=Buffer.from(match[1],'base64').toString('utf8');
  const digest=createHash('sha256').update(worker).digest('hex');
  if(digest!=='7ba6b482f49ff3d49290b85f4ca13d5c6a5787b237cac1c6d15129668d36f529')throw Error('Vosk worker changed; review its CSP adaptation before building.');
  const namedStart=worker.indexOf('function createNamedFunction('),namedEnd=worker.indexOf('var emval_free_list=',namedStart);
  const invokerStart=worker.indexOf('function craftInvokerFunction('),invokerEnd=worker.indexOf('function heap32VectorToArray(',invokerStart);
  if(namedStart<0||namedEnd<0||invokerStart<0||invokerEnd<0)throw Error('Vosk embind wrappers changed.');
  worker=worker.slice(0,invokerStart)+INVOKER+worker.slice(invokerEnd);
  worker=worker.slice(0,namedStart)+NAMED_WRAPPER+worker.slice(namedEnd);
  const callerStart=worker.indexOf('function __emval_get_method_caller('),callerEnd=worker.indexOf('function __emval_incref(',callerStart);
  if(callerStart<0||callerEnd<0)throw Error('Vosk method wrapper changed.');
  worker=worker.slice(0,callerStart)+METHOD_CALLER+worker.slice(callerEnd);
  // Model setup can fail or be cancelled before a native model exists.
  if(!worker.includes('this.model.delete();'))throw Error('Vosk model cleanup changed.');
  worker=worker.replace('this.model.delete();','if(this.model)this.model.delete();');
  if(/new Function\(|new_\(Function,/.test(worker))throw Error('Unexpected remaining dynamic Vosk code generation.');
  source=source.replace(match[1],Buffer.from(worker).toString('base64'));
  const prefix=source.indexOf("(exports) { 'use strict';");
  if(prefix<0||!source.trimEnd().endsWith('}));'))throw Error('Unrecognized Vosk module wrapper.');
  return source.slice(prefix+"(exports) { 'use strict';".length).replace(/\s*exports\.Model = Model;[\s\S]*$/, '\nexport {Model,createModel};\n');
}

export function voskCspPlugin(){
  return {name:'mother-local-recognition-csp',resolveId(id){if(id===MODULE_ID)return '\0'+MODULE_ID;},load(id){if(id==='\0'+MODULE_ID)return adaptVoskSource(readFileSync(require.resolve('vosk-browser'),'utf8'));}};
}
