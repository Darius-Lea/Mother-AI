/* Audio-thread capture avoids missing speech when the 3D UI is busy. Vosk's
 * worker expects 16-bit-scale float PCM. No network or storage is used here. */
class MotherSpeechCapture extends AudioWorkletProcessor {
  constructor(){super();this.destination=null;this.recognizerId=null;this.buffer=new Float32Array(4096);this.offset=0;this.port.onmessage=event=>{this.destination=event.data?.port||null;this.recognizerId=event.data?.recognizerId||null;};}
  process(inputs){
    const samples=inputs[0]?.[0];
    if(!samples||!this.destination)return true;
    for(let index=0;index<samples.length;index++){
      this.buffer[this.offset++]=samples[index]*32768;
      if(this.offset===this.buffer.length){const data=this.buffer;this.destination.postMessage({action:'audioChunk',recognizerId:this.recognizerId,data,sampleRate},{transfer:[data.buffer]});this.buffer=new Float32Array(4096);this.offset=0;}
    }
    return true;
  }
}
registerProcessor('mother-speech-capture',MotherSpeechCapture);
