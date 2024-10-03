class Queue {
  constructor(concurrency = 1, useCallback = false) {
    this.queue = [];
    this.useCallback = useCallback; // Use callback instead of promises
    this.concurrency = concurrency;
    this.currentlyProcessing = 0;
  }

  enqueue(task) {
    this.queue.push(task);
    this.processNext();
  }
  onComplete(){
    this.currentlyProcessing--;
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
      if (this.useCallback) {
        task(this.onComplete);
        setImmediate(() => this.processNext());
        return
      }
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