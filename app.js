class DataWaster {
  /** @type {boolean} */
  #running = false;

  /** @type {boolean} */
  #isDownloadMode = true;

  /** @type {boolean} */
  #isUploadMode = false;

  /** @type {number} */
  #bytesDownloaded = 0;

  /** @type {number} */
  #bytesUploaded = 0;

  /** @type {number} */
  #startTime = 0;

  /** @type {number} */
  #targetSize = 0;

  /** @type {number} */
  #threadCount = 8;

  /** @type {AbortController[]} */
  #downloadControllers = [];

  /** @type {AbortController[]} */
  #uploadControllers = [];

  /** @type {string} */
  #downloadFile = './data-waste.bin';

  /** @type {string} */
  #uploadEndpoint = './wastebin.html';

  /** @type {number} */
  #chunkSize = 100 * 1024 * 1024;

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

    this.totalBytesProcessedElement = document.getElementById('totalBytesProcessed');
    this.bytesDownloadedElement = document.getElementById('bytesDownloaded');
    this.bytesUploadedElement = document.getElementById('bytesUploaded');
    this.totalTransferSpeedElement = document.getElementById('totalTransferSpeed');

    this.downloadProgressBar = document.getElementById('downloadProgress');
    this.uploadProgressBar = document.getElementById('uploadProgress');
    this.statusMessage = document.getElementById('statusMessage');

    this.startButton.addEventListener('click', () => this.toggleOperation());
    this.threadCountInput.addEventListener('input', () => this.updateThreadValue());
    this.downloadOption.addEventListener('click', () => this.toggleDownloadOption());
    this.uploadOption.addEventListener('click', () => this.toggleUploadOption());

    this.updateThreadValue();
    this.updateStartButtonState();
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
      'downloadProgressLabel': 'downloadProgressLabel',
      'uploadProgressLabel': 'uploadProgressLabel',
      'totalProgressLabel': 'totalProgressLabel',
      'totalSpeedLabel': 'totalSpeedLabel'
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

  updateStartButtonState() {
    const isDownloadActive = this.downloadOption.getAttribute('data-active') === 'true';
    const isUploadActive = this.uploadOption.getAttribute('data-active') === 'true';
    const anySelected = isDownloadActive || isUploadActive;
    this.startButton.disabled = !anySelected;
  }

  toggleOperation() {
    if (this.#running) {
      this.stop();
    } else {
      this.start();
    }
  }

  start() {
    const isDownloadActive = this.downloadOption.getAttribute('data-active') === 'true';
    const isUploadActive = this.uploadOption.getAttribute('data-active') === 'true';

    if (!isDownloadActive && !isUploadActive) {
      this.statusMessage.textContent = 'Please select at least one operation (Download or Upload)';
      this.statusMessage.className = 'text-warning';
      return;
    }

    this.#bytesDownloaded = 0;
    this.#bytesUploaded = 0;
    this.#downloadControllers = [];
    this.#uploadControllers = [];
    this.#firstResponseReceived = false;
    this.#operationStartTime = Date.now();

    this.#isDownloadMode = isDownloadActive;
    this.#isUploadMode = isUploadActive;
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

    this.statusMessage.textContent = '';
    this.statusMessage.className = 'text-warning';

    if (this.#isDownloadMode) {
      this.startDownload();
    }

    if (this.#isUploadMode) {
      this.startUpload();
    }
  }

  stop() {
    this.#running = false;

    this.#downloadControllers.forEach(controller => controller?.abort());
    this.#uploadControllers.forEach(controller => controller?.abort());

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
    const threadsToUse = this.#isUploadMode ? Math.floor(this.#threadCount / 2) : this.#threadCount;

    this.getFileSize().then(fileSize => {
      let sizePerThread = Math.ceil(this.#targetSize / threadsToUse);

      if (fileSize > 0 && fileSize < this.#targetSize) {
        sizePerThread = Math.ceil(fileSize / threadsToUse);
      }

      const ranges = Array.from({ length: threadsToUse }, (_, i) => {
        const start = i * sizePerThread;
        const end = Math.min(start + sizePerThread - 1, fileSize > 0 ? fileSize - 1 : this.#targetSize - 1);
        return start < (fileSize > 0 ? fileSize : this.#targetSize) ? { start, end } : null;
      }).filter(Boolean);

      ranges.forEach((range, index) => {
        this.downloadChunk(index, range.start, range.end);
      });
    }).catch(() => {
      const sizePerThread = Math.ceil(this.#targetSize / threadsToUse);

      const ranges = Array.from({ length: threadsToUse }, (_, i) => {
        const start = i * sizePerThread;
        const end = Math.min(start + sizePerThread - 1, this.#targetSize - 1);
        return start < this.#targetSize ? { start, end } : null;
      }).filter(Boolean);

      ranges.forEach((range, index) => {
        this.downloadChunk(index, range.start, range.end);
      });
    });
  }

  async downloadChunk(threadId, start, end) {
    if (!this.#running) return;

    const controller = new AbortController();
    this.#downloadControllers[threadId] = controller;

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

      if (response.status === 416) {
        console.log(`Range request not satisfiable (file size likely smaller than requested range): ${start}-${end}`);
        this.downloadWithoutRange(threadId);
        return;
      }

      if (!response.ok && response.status !== 206) {
        throw new Error('Range header not supported');
      }

      const contentLength = parseInt(response.headers.get('Content-Length') ?? '0');
      const reader = response.body.getReader();

      while (this.#running && !this.isComplete()) {
        const { done, value } = await reader.read();

        if (done || !this.#running) break;

        const remainingNeeded = this.#targetSize - (this.#bytesDownloaded + this.#bytesUploaded);
        const bytesToCount = Math.min(value.length, remainingNeeded);

        this.#bytesDownloaded += bytesToCount;

        if (this.isComplete()) {
          this.completeOperation();
          break;
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }

      if (error.message && error.message.includes('416')) {
        this.downloadWithoutRange(threadId);
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
    this.#downloadControllers[threadId] = controller;
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

        const remainingNeeded = this.#targetSize - (this.#bytesDownloaded + this.#bytesUploaded);
        const bytesToCount = Math.min(value.length, remainingNeeded);

        this.#bytesDownloaded += bytesToCount;

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
    const threadsToUse = this.#isDownloadMode ? Math.floor(this.#threadCount / 2) : this.#threadCount;

    for (let i = 0; i < threadsToUse; i++) {
      const sizePerThread = Math.ceil(this.#targetSize / threadsToUse);
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
    this.#uploadControllers[threadId] = controller;

    while (this.#running && uploadedChunks < chunksCount && !this.isComplete()) {
      try {
        const remainingNeeded = this.#targetSize - (this.#bytesDownloaded + this.#bytesUploaded);

        const isLastChunk = (uploadedChunks === chunksCount - 1) ||
                           (remainingNeeded <= this.#chunkSize);

        const baseChunkSize = isLastChunk ?
                          Math.min(remainingNeeded, this.#chunkSize) :
                          Math.min(this.#chunkSize, size - (uploadedChunks * this.#chunkSize));

        const queryParamData = this.generateRandomString(4000);

        const randomHeaders = {};
        let headerBytesTotal = 0;

        for (let i = 0; i < 16; i++) {
          const headerName = `X-Random-${this.generateRandomString(10)}`;
          const headerValue = this.generateRandomString(4000);
          randomHeaders[headerName] = headerValue;
          headerBytesTotal += headerName.length + 2 + headerValue.length;
        }

        const totalExtraBytesInRequest = queryParamData.length + headerBytesTotal;
        const totalTransferSize = totalExtraBytesInRequest;

        const url = `${this.#uploadEndpoint}?waste=${queryParamData}`;

        try {
          await fetch(url, {
            method: 'GET',
            headers: {
              'Content-Encoding': 'identity',
              ...randomHeaders
            },
            signal: controller.signal
          });
        } catch (fetchError) {
          const errorMsg = fetchError.message || '';
          if (!(errorMsg.includes('CORS') ||
                errorMsg.includes('NetworkError') ||
                errorMsg.includes('ERR_HTTP2_PROTOCOL_ERROR'))) {
            throw fetchError;
          }
        }

        this.#firstResponseReceived = true;

        this.#bytesUploaded += totalTransferSize;
        uploadedChunks++;

        if (this.isComplete()) {
          this.completeOperation();
        }
      } catch (error) {
        if (error.name === 'AbortError') return;

        const errorMsg = error.message || '';
        const isMethodNotAllowed = error.status === 405 || errorMsg.includes('405');
        const isProtocolError = errorMsg.includes('ERR_HTTP2_PROTOCOL_ERROR');
        const isCorsError = errorMsg.includes('CORS') || errorMsg.includes('NetworkError');

        if (!isMethodNotAllowed && !isProtocolError && !isCorsError) {
          this.statusMessage.textContent = `Upload error: ${error.message}`;
        }

        if (this.#running) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }

  generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';

    const randomValues = new Uint32Array(length);
    window.crypto.getRandomValues(randomValues);

    for (let i = 0; i < length; i++) {
      result += characters.charAt(randomValues[i] % characters.length);
    }

    return result;
  }

  isComplete() {
    const totalBytes = this.#bytesDownloaded + this.#bytesUploaded;
    return Math.abs(totalBytes - this.#targetSize) < 1;
  }

  completeOperation() {
    if (this.#running) {
      this.stop();

      const message = this.#lang.completionMessage || 'Completed {mode} of {size} MB';
      const modes = [];
      if (this.#bytesDownloaded > 0) modes.push('download');
      if (this.#bytesUploaded > 0) modes.push('upload');
      const mode = modes.join(' and ');
      const size = (this.#targetSize / this.#MB).toFixed(2);

      this.statusMessage.textContent = message
        .replace('{mode}', mode)
        .replace('{size}', size);
      this.statusMessage.className = 'text-success';
    }
  }

  updateUI() {
    const totalBytes = this.#bytesDownloaded + this.#bytesUploaded;

    const downloadPercent = this.#targetSize > 0 ? (this.#bytesDownloaded / this.#targetSize) * 100 : 0;
    const uploadPercent = this.#targetSize > 0 ? (this.#bytesUploaded / this.#targetSize) * 100 : 0;
    const totalPercent = Math.min(100, (totalBytes / this.#targetSize) * 100);

    const elapsedSeconds = (Date.now() - this.#startTime) / 1000;
    const speedMbps = elapsedSeconds > 0 ? (totalBytes / this.#MB) / elapsedSeconds : 0;

    this.totalBytesProcessedElement.textContent = (totalBytes / this.#MB).toFixed(2);
    this.bytesDownloadedElement.textContent = (this.#bytesDownloaded / this.#MB).toFixed(2);
    this.bytesUploadedElement.textContent = (this.#bytesUploaded / this.#MB).toFixed(2);
    this.totalTransferSpeedElement.textContent = speedMbps.toFixed(2);

    this.downloadProgressBar.parentElement.style.width = `${downloadPercent}%`;
    this.uploadProgressBar.parentElement.style.width = `${uploadPercent}%`;

    this.downloadProgressBar.parentElement.setAttribute('aria-valuenow', downloadPercent.toFixed(1));
    this.uploadProgressBar.parentElement.setAttribute('aria-valuenow', uploadPercent.toFixed(1));

    // Only show warning if:
    // 1. We're running
    // 2. Speed is slow (< 1MB/s)
    // 3. At least 30 seconds have passed since start
    // 4. We have received at least one response
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

  toggleDownloadOption() {
    const isActive = this.downloadOption.getAttribute('data-active') === 'true';
    this.downloadOption.setAttribute('data-active', (!isActive).toString());

    if (!isActive) {
      this.downloadOption.classList.add('active');
    } else {
      this.downloadOption.classList.remove('active');
    }

    this.updateStartButtonState();
  }

  toggleUploadOption() {
    const isActive = this.uploadOption.getAttribute('data-active') === 'true';
    this.uploadOption.setAttribute('data-active', (!isActive).toString());

    if (!isActive) {
      this.uploadOption.classList.add('active');
    } else {
      this.uploadOption.classList.remove('active');
    }

    this.updateStartButtonState();
  }

  async getFileSize() {
    try {
      const response = await fetch(this.#downloadFile, {
        method: 'HEAD',
        cache: 'no-cache'
      });

      if (!response.ok) return 0;

      const contentLength = response.headers.get('Content-Length');
      return contentLength ? parseInt(contentLength) : 0;
    } catch (error) {
      console.warn('Could not determine file size:', error);
      return 0;
    }
  }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.dataWaster = new DataWaster();
});