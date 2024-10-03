(function () {
  const originalLog = console.log;
  const logContainer = document.getElementById('logContainer');
  let logLines = [];

  console.log = function (...args) {
    // Call original console.log for debugging in the browser console
    originalLog.apply(console, args);

    // Convert arguments to a string and format
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');

    // Append the log to the log container
    logLines.push(message);
    if (logLines.length > 2000) {
      logLines.shift(); // Remove oldest log line to maintain a limit of 2000 lines
    }

    // Update the UI
    logContainer.textContent = logLines.join('\n');

    // Scroll to the bottom of the container
    logContainer.scrollTop = logContainer.scrollHeight;
  };
})();
