import express from 'express';
import CompreSJON from '../src/index';

interface User {
  name: string;
  age: number;
}

// Helper function to format bytes into human-readable format
function formatBytes(bytes: number) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Byte';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
}

// Create a new CompreSJON instance with an initial JSON object
const users = new CompreSJON<User[]>([]);

// Initialize the Express app
const app = express();
app.use(express.json());

// Define an API endpoint for adding a new user
app.post('/users', (req, res) => {
  const user = req.body;

  // Append the new user to the existing JSON object
  const data = CompreSJON.dump(users);
  data.push(user);
  users.update(data);

  // Log the current memory usage
  const memoryUsage = process.memoryUsage();
  console.log('Memory Usage (MB):', {
    rss: formatBytes(memoryUsage.rss),
    heapTotal: formatBytes(memoryUsage.heapTotal),
    heapUsed: formatBytes(memoryUsage.heapUsed),
    external: formatBytes(memoryUsage.external),
  });

  res.status(201).json({ message: 'User created successfully' });
});

// Define an API endpoint for retrieving all users
app.get('/users', (req, res) => {
  // Log the current memory usage
  const memoryUsage = process.memoryUsage();
  console.log('Memory Usage (MB):', {
    rss: formatBytes(memoryUsage.rss),
    heapTotal: formatBytes(memoryUsage.heapTotal),
    heapUsed: formatBytes(memoryUsage.heapUsed),
    external: formatBytes(memoryUsage.external),
  });

  res.json(CompreSJON.parse(users));
});

// Start the server
app.listen(3000, () => {
  console.log('Server started on port 3000');
});
