import { getFilesDB } from './db.js';
import { fileCard } from './ui.js';

class TimeScaleChart {
  constructor(canvasId, onDateSelected) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.onDateSelected = onDateSelected;
    this.data = [];
    this.selectedDate = null;
    this.handleClick = this.handleClick.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseOut = this.handleMouseOut.bind(this);
    this.handleResize = this.handleResize.bind(this);

    window.addEventListener('resize', () => this.draw());
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseout', this.handleMouseOut);
  }
  handleMouseMove(event) {
    const tooltip = document.getElementById('chart-tooltip');
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const width = this.canvas.width;
    const barWidth = width / this.data.length;
    const index = Math.floor(x / barWidth);

    if (index >= 0 && index < this.data.length) {
      const { month, count } = this.data[index];
      tooltip.style.display = 'block';
      tooltip.style.left = `${event.pageX + 10}px`; // Slight offset to the right of the mouse
      tooltip.style.top = `${event.pageY - 20}px`; // Slight offset above the mouse
      tooltip.textContent = `${month}: ${count} photos`;
    } else {
      tooltip.style.display = 'none';
    }
  }

  handleMouseOut() {
    const tooltip = document.getElementById('chart-tooltip');
    tooltip.style.display = 'none';
  }


  async loadData() {
    // Aggregate number of photos per day
    const db = await getFilesDB()
    const dateCountMap = {};
    await db.files.each(photo => {
      const date = new Date(photo.takenDateTime);
      const monthKey = date.toISOString().substring(0, 7);
      if (dateCountMap[monthKey]) {
        dateCountMap[monthKey]++;
      } else {
        dateCountMap[monthKey] = 1;
      }
    });
    // Convert to sorted array
    this.data = Object.keys(dateCountMap).map(month => ({
      month,
      count: dateCountMap[month]
    })).sort((a, b) => a.month.localeCompare(b.month));
  }

  async render() {
    await this.loadData();
    this.canvas.addEventListener('click', this.handleClick);
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const width = this.canvas.width = this.canvas.clientWidth;
    const height = this.canvas.height = this.canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    if (this.data.length === 0) return;

    // Determine scaling
    const maxCount = Math.max(...this.data.map(d => d.count));
    const barWidth = width / this.data.length;
    const scale = height / maxCount;

    // Draw area chart
    ctx.beginPath();
    ctx.moveTo(0, height);
    this.data.forEach((d, i) => {
      const x = i * barWidth;
      const y = height - d.count * scale;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = 'rgba(100, 150, 250, 0.6)';
    ctx.fill();

  }


  handleClick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const width = this.canvas.width;
    const barWidth = width / this.data.length;
    const index = Math.floor(x / barWidth);
    if (index >= 0 && index < this.data.length) {
      const selected = this.data[index].month;
      this.onDateSelected(selected);
    }
  }

  handleResize() {
    this.draw();
  }
}


class PhotoGallery {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  async displayPhotosByMonth(month) {
    this.container.innerHTML = ''; // Clear previous photos

    // Fetch photos for the selected date
    const [year, monthNum] = month.split('-').map(num => parseInt(num, 10));
    const start = new Date(year, monthNum-1, 1);
    //add one month to the start date
    const db = await getFilesDB()
    const photos = await db.files
      .where('takenDateTime')
      .aboveOrEqual(start.toISOString())
      .limit(1000)
      .toArray();
    if (photos.length === 0) {
      this.container.innerHTML = '<p>No photos found for this date.</p>';
      return;
    }

    // Group photos by date (though all should be same date)
    const grouped = photos.reduce((acc, photo) => {
      const dateKey = new Date(photo.takenDateTime).toISOString().split('T')[0];
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(photo);
      return acc;
    }, {});

    for (const [date, photos] of Object.entries(grouped)) {
       // Day Header
       const header = document.createElement('div');
       header.className = 'day-header';

       // Create Toggle Button
       const toggleButton = document.createElement('button');
       toggleButton.className = 'toggle-button';
       toggleButton.textContent = '−'; // Minus sign indicates expanded state

       // Append Date Text
       const dateText = document.createElement('span');
       dateText.textContent = `${date} (${photos.length} photos)`;

       // Append elements to header
       header.appendChild(toggleButton);
       header.appendChild(dateText);
       this.container.appendChild(header);

       // Photos Container
       const photosDiv = document.createElement('div');
       photosDiv.className = 'photos';
       photos.forEach(photo => {
           photosDiv.appendChild(fileCard(photo));
       });
       this.container.appendChild(photosDiv);

       // Event Listener for Toggle Button
       toggleButton.addEventListener('click', () => {
           const isHidden = photosDiv.classList.toggle('collapsed');
           toggleButton.textContent = isHidden ? '+' : '−'; // Toggle between plus and minus
       });      
    }

    // Scroll to top
    window.scrollTo(0, 0);
  }
}

async function initPhotoGallery() {
  console.log('Initializing Photo Gallery...');
  // Initialize chart
  const chart = new TimeScaleChart('time-scale-chart', async (selectedMonth ) => {
    const tooltip = document.getElementById('selected-date');
    tooltip.textContent = `Selected Month: ${selectedMonth}`;
    tooltip.style.display = 'block';
    setTimeout(() => {
        tooltip.style.display = 'none';
    }, 2000);

    // Update slider to the selected month
    const monthIndex = chart.data.findIndex(d => d.month === selectedMonth);
    if (monthIndex !== -1) {
        dateSlider.value = monthIndex;
        sliderLabel.textContent = formatMonth(selectedMonth);
    }

    // Load photos for the selected month
    await gallery.displayPhotosByMonth(selectedMonth);
  });

  // Initialize gallery
  const gallery = new PhotoGallery('gallery');

  // Render the chart
  await chart.render();
  // Initialize slider
  const dateSlider = document.getElementById('date-slider');
  const sliderLabel = document.getElementById('slider-label');

  // Populate slider based on chart data
  const totalMonths = chart.data.length;
  dateSlider.min = 0;
  dateSlider.max = totalMonths - 1;
  dateSlider.value = totalMonths - 1; // Set to latest month by default

  // Set initial slider label
  const latestMonth = chart.data[totalMonths - 1].month;
  sliderLabel.textContent = formatMonth(latestMonth);

  let debounceTimeout;
  dateSlider.addEventListener('input', async (event) => {
    const index = parseInt(event.target.value, 10);
    const selectedMonth = chart.data[index].month;
    sliderLabel.textContent = formatMonth(selectedMonth);
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
      await gallery.displayPhotosByMonth(selectedMonth);
    }, 300); // Adjust the delay as needed
  });

  // Function to format month string to a more readable format
  function formatMonth(monthStr) {
    const [year, month] = monthStr.split('-').map(num => parseInt(num, 10));
    const date = new Date(year, month - 1);
    const options = { year: 'numeric', month: 'long' };
    return date.toLocaleDateString(undefined, options);
  }

  // Optionally, display photos for the latest date on load
  if (chart.data.length > 0) {
    const latestMonth = chart.data[chart.data.length - 1].month;
    await gallery.displayPhotosByMonth(latestMonth);
  }
}

export { initPhotoGallery };