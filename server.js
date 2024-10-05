import express from 'express'
import morgan from 'morgan';

const DEFAULT_PORT = process.env.PORT || 3000;


// initialize express.
const app = express();

app.use(express.json());

// Initialize variables.
let port = DEFAULT_PORT;

// Configure morgan module to log all requests.
app.use(morgan('dev'));


// Setup app folders.
app.use(express.static('app'));


// Start the server.
app.listen(port);
console.log(`Listening on port ${port}...`);
