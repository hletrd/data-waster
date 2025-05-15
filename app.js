class DataWaster {
  /** @type {boolean} */
  #running = false;

  /** @type {boolean} */
  #isDownloadMode = true;

  /** @type {number} */
  #bytesProcessed = 0;

  /** @type {number} */
  #startTime = 0;

  /** @type {number} */
  #targetSize = 0;

  /** @type {number} */
  #threadCount = 8;

  /** @type {AbortController[]} */
  #controllers = [];

  /** @type {string} */
  #downloadFile = './data-waste.bin';

  /** @type {string} */
  #uploadEndpoint = './wastebin.html';

  /** @type {number} */
  #chunkSize = 1024 * 1024;

  /** @type {number} */
  #MB = 1048576;

  /** @type {number} */
  #updateInterval = null;

  /** @type {object} */
  #lang = {};

  /** @type {number} */
  #operationStartTime = 0;

  /** @type {boolean} */
  #firstResponseReceived = false;

  constructor() {
    this.threadCountInput = document.getElementById('threadCount');
    this.threadValueDisplay = document.getElementById('threadValue');
    this.startButton = document.getElementById('startButton');
    this.dataSizeInput = document.getElementById('dataSize');
    this.downloadOption = document.getElementById('downloadOption');
    this.uploadOption = document.getElementById('uploadOption');
    this.bytesProcessedElement = document.getElementById('bytesProcessed');
    this.transferSpeedElement = document.getElementById('transferSpeed');
    this.progressBar = document.getElementById('transferProgress');
    this.statusMessage = document.getElementById('statusMessage');

    this.startButton.addEventListener('click', () => this.toggleOperation());
    this.threadCountInput.addEventListener('input', () => this.updateThreadValue());

    this.updateThreadValue();
    this.loadLanguage().then(() => this.applyLanguage());
  }

  async loadLanguage() {
    const langCode = navigator.language.startsWith('ko') ? 'ko' : 'en';

    try {
      const response = await fetch(`./langs-${langCode}.json`);
      if (!response.ok) throw new Error('Failed to load language file');
      this.#lang = await response.json();
    } catch (error) {
      console.error('Error loading language file:', error);
      try {
        const fallbackResponse = await fetch('./langs-en.json');
        this.#lang = await fallbackResponse.json();
      } catch (e) {
        console.error('Could not load fallback language file:', e);
      }
    }
  }

  applyLanguage() {
    const elementsToTranslate = {
      'title': 'title',
      'desc': 'desc',
      'downloadLabel': 'downloadLabel',
      'uploadLabel': 'uploadLabel',
      'sizeLabel': 'sizeLabel',
      'threadLabel': 'threadLabel',
      'progressLabel': 'progressLabel',
      'speedLabel': 'speedLabel'
    };

    Object.entries(elementsToTranslate).forEach(([key, id]) => {
      const element = document.getElementById(id);
      if (element && this.#lang[key]) {
        element.textContent = this.#lang[key];
      }
    });

    if (this.startButton && this.#lang.startButton) {
      this.startButton.textContent = this.#lang.startButton;
    }
  }

  updateThreadValue() {
    this.#threadCount = parseInt(this.threadCountInput.value);
    this.threadValueDisplay.textContent = this.#threadCount;
  }

  toggleOperation() {
    if (this.#running) {
      this.stop();
    } else {
      this.start();
    }
  }

  start() {
    this.#bytesProcessed = 0;
    this.#controllers = [];
    this.#firstResponseReceived = false;
    this.#operationStartTime = Date.now();

    this.#isDownloadMode = this.downloadOption.checked;
    this.#targetSize = parseInt(this.dataSizeInput.value) * this.#MB;

    if (isNaN(this.#targetSize) || this.#targetSize <= 0) {
      this.statusMessage.textContent = this.#lang.invalidSizeError || 'Please enter a valid data size greater than 0 MB';
      return;
    }

    this.startButton.textContent = this.#lang.stopButton || 'Stop';
    this.dataSizeInput.disabled = true;
    this.downloadOption.disabled = true;
    this.uploadOption.disabled = true;
    this.threadCountInput.disabled = true;
    this.#running = true;
    this.#startTime = Date.now();
    this.updateUI();

    this.#updateInterval = setInterval(() => this.updateUI(), 100);

    if (this.#isDownloadMode) {
      this.startDownload();
    } else {
      this.startUpload();
    }
  }

  stop() {
    this.#running = false;

    this.#controllers.forEach(controller => {
      if (controller) controller.abort();
    });

    this.startButton.textContent = this.#lang.startButton || 'Start';
    this.dataSizeInput.disabled = false;
    this.downloadOption.disabled = false;
    this.uploadOption.disabled = false;
    this.threadCountInput.disabled = false;

    if (this.#updateInterval) {
      clearInterval(this.#updateInterval);
      this.#updateInterval = null;
    }
  }

  startDownload() {
    const sizePerThread = Math.ceil(this.#targetSize / this.#threadCount);
    const ranges = Array.from({ length: this.#threadCount }, (_, i) => {
      const start = i * sizePerThread;
      const end = Math.min(start + sizePerThread - 1, this.#targetSize - 1);
      return start < this.#targetSize ? { start, end } : null;
    }).filter(Boolean);

    ranges.forEach((range, index) => {
      this.downloadChunk(index, range.start, range.end);
    });
  }

  async downloadChunk(threadId, start, end) {
    if (!this.#running) return;

    const controller = new AbortController();
    this.#controllers[threadId] = controller;

    const url = `${this.#downloadFile}?t=${Date.now()}-${Math.random()}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Range': `bytes=${start}-${end}`,
          'Accept-Encoding': 'identity'
        },
        signal: controller.signal
      });

      this.#firstResponseReceived = true;

      if (!response.ok && response.status !== 206) {
        throw new Error('Range header not supported');
      }

      const contentLength = parseInt(response.headers.get('Content-Length') ?? '0');
      const reader = response.body.getReader();

      while (this.#running && !this.isComplete()) {
        const { done, value } = await reader.read();

        if (done || !this.#running) break;

        const remainingNeeded = this.#targetSize - this.#bytesProcessed;
        const bytesToCount = Math.min(value.length, remainingNeeded);

        this.#bytesProcessed += bytesToCount;

        if (this.isComplete()) {
          this.completeOperation();
          break;
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }

      if (error.message === 'Range header not supported' && this.#running) {
        this.downloadWithoutRange(threadId);
        return;
      }

      this.statusMessage.textContent = `Error: ${error.message}`;
    }
  }

  async downloadWithoutRange(threadId) {
    if (!this.#running) return;

    const controller = new AbortController();
    this.#controllers[threadId] = controller;
    const url = `${this.#downloadFile}?t=${Date.now()}-${Math.random()}`;

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept-Encoding': 'identity'
        }
      });
      const reader = response.body.getReader();

      while (this.#running) {
        const { done, value } = await reader.read();

        if (done) {
          if (this.#running && !this.isComplete()) {
            this.downloadWithoutRange(threadId);
          }
          break;
        }

        const remainingNeeded = this.#targetSize - this.#bytesProcessed;
        const bytesToCount = Math.min(value.length, remainingNeeded);

        this.#bytesProcessed += bytesToCount;

        if (this.isComplete()) {
          this.completeOperation();
          break;
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError' && this.#running) {
        this.statusMessage.textContent = `Error: ${error.message}`;
      }
    }
  }

  startUpload() {
    for (let i = 0; i < this.#threadCount; i++) {
      const sizePerThread = Math.ceil(this.#targetSize / this.#threadCount);
      const threadSize = Math.min(sizePerThread, this.#targetSize - (i * sizePerThread));

      if (threadSize > 0) {
        this.uploadChunk(i, threadSize);
      }
    }
  }

  async uploadChunk(threadId, size) {
    if (!this.#running) return;

    const chunksCount = Math.ceil(size / this.#chunkSize);
    let uploadedChunks = 0;

    const controller = new AbortController();
    this.#controllers[threadId] = controller;

    while (this.#running && uploadedChunks < chunksCount && !this.isComplete()) {
      try {
        const remainingNeeded = this.#targetSize - this.#bytesProcessed;

        const isLastChunk = (uploadedChunks === chunksCount - 1) ||
                           (remainingNeeded <= this.#chunkSize);

        const chunkSize = isLastChunk ?
                          Math.min(remainingNeeded, this.#chunkSize) :
                          Math.min(this.#chunkSize, size - (uploadedChunks * this.#chunkSize));

        const data = digitalWaste(chunkSize);

        const blob = new Blob([data], { type: 'application/octet-stream' });
        const formData = new FormData();
        formData.append('file', blob, 'waste.bin');

        await fetch(this.#uploadEndpoint, {
          method: 'POST',
          body: formData,
          headers: {
            'Content-Encoding': 'identity'
          },
          signal: controller.signal
        });

        this.#firstResponseReceived = true;

        this.#bytesProcessed += chunkSize;
        uploadedChunks++;

        if (this.isComplete()) {
          this.completeOperation();
        }
      } catch (error) {
        if (error.name === 'AbortError') return;

        const errorMsg = error.message || '';
        const isMethodNotAllowed = error.status === 405 || errorMsg.includes('405');
        const isProtocolError = errorMsg.includes('ERR_HTTP2_PROTOCOL_ERROR');

        if (!isMethodNotAllowed && !isProtocolError) {
          this.statusMessage.textContent = `Upload error: ${error.message}`;
        }

        if (this.#running) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }

  isComplete() {
    return Math.abs(this.#bytesProcessed - this.#targetSize) < 1;
  }

  completeOperation() {
    if (this.#running) {
      this.stop();

      const message = this.#lang.completionMessage || 'Completed {mode} of {size} MB';
      const mode = this.#isDownloadMode ? 'download' : 'upload';
      const size = (this.#targetSize / this.#MB).toFixed(2);

      this.statusMessage.textContent = message
        .replace('{mode}', mode)
        .replace('{size}', size);
      this.statusMessage.className = 'text-success';
    }
  }

  updateUI() {
    const progressPercent = Math.min(100, (this.#bytesProcessed / this.#targetSize) * 100);

    const elapsedSeconds = (Date.now() - this.#startTime) / 1000;
    const speedMbps = elapsedSeconds > 0
      ? (this.#bytesProcessed / this.#MB) / elapsedSeconds
      : 0;

    this.bytesProcessedElement.textContent = (this.#bytesProcessed / this.#MB).toFixed(2);
    this.transferSpeedElement.textContent = speedMbps.toFixed(2);
    this.progressBar.style.width = `${progressPercent}%`;

    const timeSinceStart = Date.now() - this.#operationStartTime;
    const shouldShowWarning = this.#running &&
                             speedMbps < 1 &&
                             timeSinceStart > 30000 &&
                             this.#firstResponseReceived;

    if (shouldShowWarning) {
      this.statusMessage.textContent = this.#lang.slowNetworkWarning ||
        'Your network is not fast enough to efficiently waste your data.';
      this.statusMessage.className = 'text-warning';
    } else if (this.#running && this.statusMessage.textContent === this.#lang.slowNetworkWarning) {
      this.statusMessage.textContent = '';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.dataWaster = new DataWaster();
});