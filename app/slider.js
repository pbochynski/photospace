const slider = document.getElementById('date-slider');
const sliderValue = document.getElementById('slider-value');
document.querySelectorAll('.slider-button').forEach((btn) => {  
  btn.addEventListener('click', (e) => {
    const m = e.target.id.split('-')[0];
    if (mode==m) return
    selectedDate = calculateDate(slider.value);
    mode = e.target.id.split('-')[0];
    slider.value = 0;
    populateSliderValues();
    updateSlider();
  });
});

function populateSliderValues() {
  const valuesDatalist = document.getElementById('values')
  valuesDatalist.innerHTML = '';
  for (let i=Number(slider.min); i<=Number(slider.max); i+=5) {
    const date = calculateDate(i);
    const option = document.createElement('option');
    option.value = i;
    option.textContent = formatDate(date);
    valuesDatalist.appendChild(option);
  }
}

let selectedDate = new Date();  // Reference date as today
let mode = 'day';  // Default mode

// Helper function to format date to YYYY-MM-DD
function formatDate(date) {
  console.log('formatDate:', date);
  if (mode === 'day') {
    return date.toISOString().slice(0, 10);
  }
  if (mode === 'month') {
    return date.toLocaleString('default', { month: 'long', year: 'numeric' });
  }
  if (mode === 'year') {
    return date.getFullYear();
  }
}

// Get the date corresponding to the slider value
function calculateDate(offset) {
  offset = Number(offset);
  console.log('calculateDate:', offset, selectedDate);
  if (mode === 'day') {
    return newDate = new Date(selectedDate.getTime() + offset * 1000 * 60 * 60 * 24);
  }
  if (mode === 'month') {
    console.log(selectedDate.getMonth(), offset);
    const d=new Date(selectedDate.getFullYear(), selectedDate.getMonth()+offset, selectedDate.getDate());
    console.log('calculateDate:', selectedDate, d);
    return d
  }
  if (mode === 'year') {
    return new Date(selectedDate.getFullYear() + offset, selectedDate.getMonth(), selectedDate.getDate());
  }
}

// Handle non-linear scaling beyond 7 days
function getNonLinearDays(val) {
  const absVal = Math.abs(val);
  if (absVal <= 7) return val;

  const sign = val < 0 ? -1 : 1;
  const expVal = 2 ** (Math.floor(Math.log2(absVal - 7)) + 1); // Exponential growth
  return 7 * sign + (expVal - 7) * sign;
}

// Update the slider's position and value display
function updateSlider() {
  const d = calculateDate(slider.value);
  console.log('updateSlider:', d);
  
  sliderValue.textContent = formatDate(d);
}


let debounceTimeout
// On slider input event
slider.addEventListener('input', () => {
  if (debounceTimeout) clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    if (Math.abs(slider.value) == slider.max){
      selectedDate = calculateDate(slider.value);
      populateSliderValues();
      slider.value = 0;
  
    }
  }, 600); // Adjust the delay as needed
  updateSlider();
});

// Center the slider value to the current selection after releasing (adjusting the range)
slider.addEventListener('change', () => {
  if (debounceTimeout) clearTimeout(debounceTimeout);
  // selectedDate = calculateDate(slider.value);
  // populateSliderValues();
  updateSlider();
});

// Initialize the slider with the current date
populateSliderValues();
updateSlider();
