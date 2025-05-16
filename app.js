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
      'totalSpeedLabel': 'totalSpeedLabel',
      'toggleHint': 'toggleHint'
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

    const isInfiniteMode = this.#targetSize === 0;

    if (!isInfiniteMode && (isNaN(this.#targetSize) || this.#targetSize < 0)) {
      this.statusMessage.textContent = this.#lang.invalidSizeError || 'Please enter a valid data size greater than 0 MB';
      return;
    }

    if (isInfiniteMode) {
      this.statusMessage.textContent = 'Running in infinite mode. Data waster will run until manually stopped.';
      this.statusMessage.className = 'text-info';
    } else {
      this.statusMessage.textContent = '';
      this.statusMessage.className = 'text-warning';
    }

    this.startButton.textContent = this.#lang.stopButton || 'Stop';
    this.dataSizeInput.disabled = true;
    this.downloadOption.disabled = true;
    this.uploadOption.disabled = true;
    this.threadCountInput.disabled = true;
    this.#running = true;
    this.#startTime = Date.now();
    this.updateUI();

    this.#updateInterval = setInterval(() => this.updateUI(), 50);

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

    this.updateUI();

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

    while (this.#running && !this.isComplete()) {
      try {
        const url = `${this.#downloadFile}?t=${Date.now()}-${Math.random()}`;

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

        let isDone = false;
        while (this.#running && !this.isComplete() && !isDone) {
          const { done, value } = await reader.read();

          if (done || !this.#running) {
            isDone = true;
            break;
          }

          const remainingNeeded = this.#targetSize - (this.#bytesDownloaded + this.#bytesUploaded);
          const bytesToCount = Math.min(value.length, remainingNeeded);

          this.#bytesDownloaded += bytesToCount;

          if (this.isComplete()) {
            this.completeOperation();
            return;
          }
        }

        if (!this.isComplete() && this.#running) {
          await new Promise(resolve => setTimeout(resolve, 50));
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

        console.warn(`Download error (continuing anyway): ${error.message}`);

        if (this.#running && !this.isComplete()) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  }

  async downloadWithoutRange(threadId) {
    if (!this.#running) return;

    const controller = new AbortController();
    this.#downloadControllers[threadId] = controller;

    while (this.#running && !this.isComplete()) {
      try {
        const url = `${this.#downloadFile}?t=${Date.now()}-${Math.random()}`;

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept-Encoding': 'identity'
          }
        });

        this.#firstResponseReceived = true;
        const reader = response.body.getReader();

        let isDone = false;
        while (this.#running && !isDone) {
          const { done, value } = await reader.read();

          if (done) {
            isDone = true;
            break;
          }

          if (!this.#running) break;

          const remainingNeeded = this.#targetSize - (this.#bytesDownloaded + this.#bytesUploaded);
          const bytesToCount = Math.min(value.length, remainingNeeded);

          this.#bytesDownloaded += bytesToCount;

          if (this.isComplete()) {
            this.completeOperation();
            return;
          }
        }

        if (this.#running && !this.isComplete()) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        if (error.name !== 'AbortError' && this.#running) {
          console.warn(`Download error (continuing anyway): ${error.message}`);
        }

        if (this.#running && !this.isComplete() && error.name !== 'AbortError') {
          await new Promise(resolve => setTimeout(resolve, 500));
        } else if (error.name === 'AbortError') {
          return;
        }
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

    const controller = new AbortController();
    this.#uploadControllers[threadId] = controller;

    while (this.#running && !this.isComplete()) {
      try {
        const remainingNeeded = this.#targetSize - (this.#bytesDownloaded + this.#bytesUploaded);

        const queryParamData = this.generateRandomString(4000);

        const randomHeaders = {};
        let headerBytesTotal = 0;

        for (let i = 0; i < 16; i++) {
          const headerName = `X-Random-${this.generateRandomString(10)}`;
          const headerValue = this.generateRandomString(4000);
          randomHeaders[headerName] = headerValue;
          headerBytesTotal += headerName.length + 2 + headerValue.length;
        }

        const totalTransferSize = queryParamData.length + headerBytesTotal;
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

          this.#firstResponseReceived = true;
        } catch (fetchError) {
          const errorMsg = fetchError.message || '';
          if (!(errorMsg.includes('CORS') ||
                errorMsg.includes('NetworkError') ||
                errorMsg.includes('ERR_HTTP2_PROTOCOL_ERROR'))) {
            console.warn(`Upload error (continuing anyway): ${errorMsg}`);
          }

          this.#firstResponseReceived = true;
        }

        this.#bytesUploaded += totalTransferSize;

        if (this.isComplete()) {
          this.completeOperation();
          break;
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return;
        }

        console.warn(`Error in upload thread ${threadId}: ${error.message}`);
      }

      if (this.#running && !this.isComplete()) {
        await new Promise(resolve => setTimeout(resolve, 30));
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
    if (this.#targetSize === 0) return false;

    const totalBytes = this.#bytesDownloaded + this.#bytesUploaded;
    return Math.abs(totalBytes - this.#targetSize) < 1;
  }

  completeOperation() {
    if (this.#running) {
      if (this.#targetSize > 0) {
        const totalBytes = this.#bytesDownloaded + this.#bytesUploaded;
        if (Math.abs(this.#targetSize - totalBytes) < this.#MB / 100) {
          if (this.#isDownloadMode && this.#isUploadMode) {
            const downloadRatio = this.#bytesDownloaded / totalBytes;
            const uploadRatio = this.#bytesUploaded / totalBytes;
            this.#bytesDownloaded = this.#targetSize * downloadRatio;
            this.#bytesUploaded = this.#targetSize * uploadRatio;
          } else if (this.#isDownloadMode) {
            this.#bytesDownloaded = this.#targetSize;
          } else if (this.#isUploadMode) {
            this.#bytesUploaded = this.#targetSize;
          }
        }
      }

      this.stop();

      this.updateUI();

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

    let downloadPercent = 0;
    let uploadPercent = 0;
    let totalPercent = 0;

    if (this.#targetSize > 0) {
      if (!this.#running && totalBytes >= this.#targetSize * 0.99) {
        downloadPercent = this.#isDownloadMode ? 100 : 0;
        uploadPercent = this.#isUploadMode ? 100 : 0;
      } else {
        downloadPercent = (this.#bytesDownloaded / this.#targetSize) * 100;
        uploadPercent = (this.#bytesUploaded / this.#targetSize) * 100;
        totalPercent = Math.min(100, (totalBytes / this.#targetSize) * 100);
      }
    } else if (this.#running) {
      const cyclePosition = (Date.now() % 5000) / 5000;
      const pulseValue = 40 * Math.sin(cyclePosition * Math.PI * 2) + 50;

      if (this.#isDownloadMode && this.#isUploadMode) {
        downloadPercent = this.#bytesDownloaded > 0 ? pulseValue / 2 : 0;
        uploadPercent = this.#bytesUploaded > 0 ? pulseValue / 2 : 0;
      } else if (this.#isDownloadMode) {
        downloadPercent = pulseValue;
      } else if (this.#isUploadMode) {
        uploadPercent = pulseValue;
      }
    }

    const elapsedSeconds = (Date.now() - this.#startTime) / 1000;
    const speedMbps = elapsedSeconds > 0 ? (totalBytes / this.#MB) / elapsedSeconds : 0;

    this.totalBytesProcessedElement.textContent = (totalBytes / this.#MB).toFixed(2);
    this.bytesDownloadedElement.textContent = (this.#bytesDownloaded / this.#MB).toFixed(2);
    this.bytesUploadedElement.textContent = (this.#bytesUploaded / this.#MB).toFixed(2);
    this.totalTransferSpeedElement.textContent = speedMbps.toFixed(2);

    const safeDownloadPercent = Math.min(100, downloadPercent);
    const safeUploadPercent = Math.min(100, uploadPercent);

    this.downloadProgressBar.parentElement.style.width = `${safeDownloadPercent}%`;
    this.uploadProgressBar.parentElement.style.width = `${safeUploadPercent}%`;

    this.downloadProgressBar.parentElement.setAttribute('aria-valuenow', safeDownloadPercent.toFixed(1));
    this.uploadProgressBar.parentElement.setAttribute('aria-valuenow', safeUploadPercent.toFixed(1));

    const timeSinceStart = Date.now() - this.#operationStartTime;
    const shouldShowWarning = this.#running &&
                             speedMbps < 1 &&
                             timeSinceStart > 30000 &&
                             this.#firstResponseReceived &&
                             this.#targetSize !== 0;

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