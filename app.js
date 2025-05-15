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
    this.localize();
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

    this.#isDownloadMode = this.downloadOption.checked;
    this.#targetSize = parseInt(this.dataSizeInput.value) * this.#MB;

    if (isNaN(this.#targetSize) || this.#targetSize <= 0) {
      this.statusMessage.textContent = 'Please enter a valid data size greater than 0 MB';
      return;
    }

    this.startButton.textContent = 'Stop';
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

    this.startButton.textContent = 'Start';
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
          'Range': `bytes=${start}-${end}`
        },
        signal: controller.signal
      });

      if (!response.ok && response.status !== 206) {
        throw new Error('Range header not supported');
      }

      const contentLength = parseInt(response.headers.get('Content-Length') ?? '0');
      const reader = response.body.getReader();

      while (this.#running && !this.isComplete()) {
        const { done, value } = await reader.read();

        if (done || !this.#running) break;

        this.#bytesProcessed += value.length;

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
      const response = await fetch(url, { signal: controller.signal });
      const reader = response.body.getReader();

      while (this.#running) {
        const { done, value } = await reader.read();

        if (done) {
          if (this.#running && !this.isComplete()) {
            this.downloadWithoutRange(threadId);
          }
          break;
        }

        this.#bytesProcessed += value.length;
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
        const chunkSize = Math.min(this.#chunkSize, size - (uploadedChunks * this.#chunkSize));
        const data = digitalWaste(chunkSize);

        const blob = new Blob([data], { type: 'application/octet-stream' });
        const formData = new FormData();
        formData.append('file', blob, 'waste.bin');

        await fetch(this.#uploadEndpoint, {
          method: 'POST',
          body: formData,
          signal: controller.signal
        });

        this.#bytesProcessed += chunkSize;
        uploadedChunks++;

        if (this.isComplete()) {
          this.completeOperation();
        }
      } catch (error) {
        if (error.name === 'AbortError') return;

        this.statusMessage.textContent = `Upload error: ${error.message}`;

        if (this.#running) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }

  isComplete() {
    return this.#bytesProcessed >= this.#targetSize;
  }

  completeOperation() {
    if (this.#running) {
      this.stop();
      this.statusMessage.textContent = `Completed ${this.#isDownloadMode ? 'download' : 'upload'} of ${(this.#targetSize / this.#MB).toFixed(2)} MB`;
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

    if (this.#running && speedMbps < 1) {
      this.statusMessage.textContent = 'Your network is not fast enough to efficiently waste your data.';
    } else if (this.#running) {
      this.statusMessage.textContent = '';
    }
  }

  localize() {
    const isKorean = navigator.language.startsWith('ko');

    if (isKorean) {
      const translations = {
        'title': '데이터 낭비기',
        'desc': '소중한 데이터를 낭비할 수 있는 가장 빠르고 효율적인 방법.',
        'downloadLabel': '다운로드',
        'uploadLabel': '업로드',
        'sizeLabel': '데이터 크기 (MB):',
        'threadLabel': '동시 연결 수:',
        'startButton': '시작',
        'progressLabel': 'MB 처리됨',
        'speedLabel': 'MB/초'
      };

      Object.entries(translations).forEach(([id, text]) => {
        document.getElementById(id).textContent = text;
      });
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.dataWaster = new DataWaster();
});