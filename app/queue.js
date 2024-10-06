class Queue {
  constructor(concurrency = 1) {
    this.queue = [];
    this.concurrency = concurrency;
    this.currentlyProcessing = 0;
  }
  // return a promise that resolves when the queue is empty and all tasks are done
  done() {
    return new Promise((resolve) => {
      const check = () => {
        if (this.queue.length === 0 && this.currentlyProcessing === 0) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }
  backoff(max = 10 ) {
    return new Promise((resolve) => {
      const check = () => {
        if (this.queue.length < max ) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      }
      check();
    });
  }

  async enqueue(task, maxQueueLength = 10) {
    await this.backoff(maxQueueLength);
    this.queue.push(task);
    this.processNext();
  }

  length() {
    return this.queue.length;
  }
  inProgress() {
    return this.currentlyProcessing;
  }

  async processNext() {
    if (
      this.currentlyProcessing < this.concurrency &&
      this.queue.length > 0
    ) {
      const task = this.queue.shift();
      this.currentlyProcessing++;
      task()
        .then(() => {
          this.currentlyProcessing--;
          this.processNext();
        })
        .catch((err) => {
          console.log('Error processing:', err);
          this.currentlyProcessing--;
          this.processNext();
        });
    }
  }
}

export { Queue };