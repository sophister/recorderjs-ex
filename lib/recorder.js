'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Recorder = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }(); /* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable no-use-before-define */
/**
 * https://github.com/mattdiamond/Recorderjs
 */


var _inlineWorker = require('inline-worker');

var _inlineWorker2 = _interopRequireDefault(_inlineWorker);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Recorder = exports.Recorder = function () {
  function Recorder(source, cfg) {
    var _this = this;

    _classCallCheck(this, Recorder);

    this.config = {
      bufferLen: 4096,
      numChannels: 2,
      mimeType: 'audio/wav'
    };
    this.recording = false;
    this.callbacks = {
      getBuffer: [],
      exportWAV: []
    };

    Object.assign(this.config, cfg);
    this.context = source.context;
    this.node = (this.context.createScriptProcessor || this.context.createJavaScriptNode).call(this.context, this.config.bufferLen, this.config.numChannels, this.config.numChannels);

    this.node.onaudioprocess = function (e) {
      if (!_this.recording) return;

      var buffer = [];
      for (var channel = 0; channel < _this.config.numChannels; channel++) {
        buffer.push(e.inputBuffer.getChannelData(channel));
      }
      _this.worker.postMessage({
        command: 'record',
        buffer: buffer
      });
    };

    source.connect(this.node);
    this.node.connect(this.context.destination); // this should not be necessary

    var self = {};
    this.worker = new _inlineWorker2.default(function () {
      var recLength = 0;
      var recBuffers = [];
      var sampleRate = void 0;
      var numChannels = void 0;

      this.onmessage = function (e) {
        // eslint-disable-next-line default-case
        switch (e.data.command) {
          case 'init':
            init(e.data.config);
            break;
          case 'record':
            record(e.data.buffer);
            break;
          case 'exportWAV':
            exportWAV(e.data.type, e.data.sampleRate);
            break;
          case 'getBuffer':
            getBuffer();
            break;
          case 'clear':
            clear();
            break;
        }
      };

      function init(config) {
        sampleRate = config.sampleRate;
        numChannels = config.numChannels;
        initBuffers();
      }

      function record(inputBuffer) {
        for (var channel = 0; channel < numChannels; channel++) {
          recBuffers[channel].push(inputBuffer[channel]);
        }
        recLength += inputBuffer[0].length;
      }

      function downSampleBuffer(buffer, rate) {
        if (rate === sampleRate) {
          return [buffer, false];
        }
        if (rate > sampleRate) {
          console.warn('downsampling rate show be smaller than original sample rate', rate, sampleRate);
          return [buffer, false];
        }
        var sampleRateRatio = sampleRate / rate;
        var newLength = Math.round(buffer.length / sampleRateRatio);
        var result = new Float32Array(newLength);
        var offsetResult = 0;
        var offsetBuffer = 0;
        while (offsetResult < result.length) {
          var nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
          // Use average value of skipped samples
          var accum = 0;var count = 0;
          for (var i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
          }
          result[offsetResult] = accum / count;
          // Or you can simply get rid of the skipped samples:
          // result[offsetResult] = buffer[nextOffsetBuffer];
          offsetResult++;
          offsetBuffer = nextOffsetBuffer;
        }
        console.log('downSampleBuffer done', sampleRate, rate);
        return [result, true];
      }

      function exportWAV(type, targetSampleRate) {
        var buffers = [];
        for (var channel = 0; channel < numChannels; channel++) {
          buffers.push(mergeBuffers(recBuffers[channel], recLength));
        }
        var interleaved = void 0;
        if (numChannels === 2) {
          interleaved = interleave(buffers[0], buffers[1]);
        } else {
          interleaved = buffers[0];
        }
        var finalRate = sampleRate;
        if (typeof targetSampleRate === 'number') {
          var temp = downSampleBuffer(interleaved, targetSampleRate);
          if (temp[1]) {
            finalRate = targetSampleRate;
            interleaved = temp[0];
          }
        }
        var dataview = encodeWAV(interleaved, finalRate);
        var audioBlob = new Blob([dataview], { type: type });

        this.postMessage({ command: 'exportWAV', data: audioBlob });
      }

      function getBuffer() {
        var buffers = [];
        for (var channel = 0; channel < numChannels; channel++) {
          buffers.push(mergeBuffers(recBuffers[channel], recLength));
        }
        this.postMessage({ command: 'getBuffer', data: buffers });
      }

      function clear() {
        recLength = 0;
        recBuffers = [];
        initBuffers();
      }

      function initBuffers() {
        for (var channel = 0; channel < numChannels; channel++) {
          recBuffers[channel] = [];
        }
      }

      function mergeBuffers(recBuffers, recLength) {
        var result = new Float32Array(recLength);
        var offset = 0;
        for (var i = 0; i < recBuffers.length; i++) {
          result.set(recBuffers[i], offset);
          offset += recBuffers[i].length;
        }
        return result;
      }

      function interleave(inputL, inputR) {
        var length = inputL.length + inputR.length;
        var result = new Float32Array(length);

        var index = 0;
        var inputIndex = 0;

        while (index < length) {
          result[index++] = inputL[inputIndex];
          result[index++] = inputR[inputIndex];
          inputIndex++;
        }
        return result;
      }

      function floatTo16BitPCM(output, offset, input) {
        for (var i = 0; i < input.length; i++, offset += 2) {
          var s = Math.max(-1, Math.min(1, input[i]));
          output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
      }

      function writeString(view, offset, string) {
        for (var i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      }

      function encodeWAV(samples, sampleRate) {
        var buffer = new ArrayBuffer(44 + samples.length * 2);
        var view = new DataView(buffer);

        /* RIFF identifier */
        writeString(view, 0, 'RIFF');
        /* RIFF chunk length */
        view.setUint32(4, 36 + samples.length * 2, true);
        /* RIFF type */
        writeString(view, 8, 'WAVE');
        /* format chunk identifier */
        writeString(view, 12, 'fmt ');
        /* format chunk length */
        view.setUint32(16, 16, true);
        /* sample format (raw) */
        view.setUint16(20, 1, true);
        /* channel count */
        view.setUint16(22, numChannels, true);
        /* sample rate */
        view.setUint32(24, sampleRate, true);
        /* byte rate (sample rate * block align) */
        view.setUint32(28, sampleRate * 4, true);
        view.setUint32(28, sampleRate * numChannels * 2, true);
        /* block align (channel count * bytes per sample) */
        view.setUint16(32, numChannels * 2, true);
        /* bits per sample */
        view.setUint16(34, 16, true);
        /* data chunk identifier */
        writeString(view, 36, 'data');
        /* data chunk length */
        view.setUint32(40, samples.length * 2, true);

        floatTo16BitPCM(view, 44, samples);

        return view;
      }
    }, self);

    this.worker.postMessage({
      command: 'init',
      config: {
        sampleRate: this.context.sampleRate,
        numChannels: this.config.numChannels
      }
    });

    this.worker.onmessage = function (e) {
      var cb = _this.callbacks[e.data.command].pop();
      if (typeof cb === 'function') {
        cb(e.data.data);
      }
    };
  }

  _createClass(Recorder, [{
    key: 'record',
    value: function record() {
      this.recording = true;
    }
  }, {
    key: 'stop',
    value: function stop() {
      this.recording = false;
    }
  }, {
    key: 'clear',
    value: function clear() {
      this.worker.postMessage({ command: 'clear' });
    }
  }, {
    key: 'getBuffer',
    value: function getBuffer(cb) {
      cb = cb || this.config.callback;
      if (!cb) throw new Error('Callback not set');

      this.callbacks.getBuffer.push(cb);

      this.worker.postMessage({ command: 'getBuffer' });
    }

    /**
     * export wav file with target sample rate
     * @param {Function} cb callback function when data is ready
     * @param {*} mimeType should be audio/wav
     * @param {*} sampleRate the target sample rate of the output wav
     */

  }, {
    key: 'exportWAV',
    value: function exportWAV(cb, mimeType, sampleRate) {
      mimeType = mimeType || this.config.mimeType;
      cb = cb || this.config.callback;
      if (!cb) throw new Error('Callback not set');

      this.callbacks.exportWAV.push(cb);

      this.worker.postMessage({
        command: 'exportWAV',
        type: mimeType,
        sampleRate: sampleRate
      });
    }
  }], [{
    key: 'forceDownload',
    value: function forceDownload(blob, filename) {
      var url = (window.URL || window.webkitURL).createObjectURL(blob);
      var link = window.document.createElement('a');
      link.href = url;
      link.download = filename || 'output.wav';
      var click = document.createEvent('Event');
      click.initEvent('click', true, true);
      link.dispatchEvent(click);
    }
  }]);

  return Recorder;
}();

exports.default = Recorder;