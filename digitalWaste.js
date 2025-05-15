
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.digitalWaste = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {

  const MB = 1024 * 1024;
  function digitalWaste(size = 100 * MB, progressCallback = null) {
    const bufferSize = Math.max(1, size);

    const buffer = new ArrayBuffer(bufferSize);
    const view = new Uint8Array(buffer);

    const chunkSize = 65536;
    const totalChunks = Math.ceil(bufferSize / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, bufferSize);
      const chunk = view.subarray(start, end);

      if (typeof window !== 'undefined' && window.crypto) {
        // Browser environment
        window.crypto.getRandomValues(chunk);
      } else if (typeof require === 'function') {
        // Node.js environment
        const crypto = require('crypto');
        crypto.randomFillSync(chunk);
      } else {
        // Fallback (less secure but still high entropy)
        for (let j = 0; j < chunk.length; j++) {
          chunk[j] = Math.floor(Math.random() * 256);
        }
      }

      if (progressCallback && typeof progressCallback === 'function') {
        progressCallback({
          bytesGenerated: end,
          totalBytes: bufferSize,
          percentComplete: Math.floor((end / bufferSize) * 100)
        });
      }
    }

    return buffer;
  }

  digitalWaste.saveToFile = function(filePath, size = 100 * MB, callback) {
    if (typeof require !== 'function') {
      throw new Error('saveToFile is only available in Node.js environment');
    }

    const fs = require('fs');
    const buffer = digitalWaste(size);
    fs.writeFile(filePath, Buffer.from(buffer), callback);
  };

  digitalWaste.download = function(filename = 'data-waste.bin', size = 100 * MB) {
    if (typeof window === 'undefined') {
      throw new Error('download is only available in browser environment');
    }

    const buffer = digitalWaste(size);
    const blob = new Blob([buffer], { type: 'application/octet-stream' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();

    setTimeout(() => URL.revokeObjectURL(link.href), 100);
  };

  return digitalWaste;
}));