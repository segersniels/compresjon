const NUMBER_OF_USERS = parseInt(process.argv[2]) || 100;
const PORT = parseInt(process.argv[3]) || 3000;

interface User {
  name: string;
  age: number;
}

async function createUser(user: User) {
  try {
    await fetch(`http://localhost:${PORT}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(user),
    });
  } catch (error) {
    console.error('Error creating user:', error);
  }
}

function generateRandomUser(): User {
  const names = ['Alice', 'Bob', 'Charlie', 'David', 'Eve', 'Frank'];
  const randomName = names[Math.floor(Math.random() * names.length)];
  const randomAge = Math.floor(Math.random() * 50) + 18;

  return { name: randomName, age: randomAge };
}

(async () => {
  console.log(`Benchmarking user creation with ${NUMBER_OF_USERS} users...`);

  const startTime = Date.now();

  for (let i = 0; i < NUMBER_OF_USERS; i++) {
    const user = generateRandomUser();
    await createUser(user);
  }

  const endTime = Date.now();
  const elapsedTime = (endTime - startTime) / 1000;

  console.log(`User creation benchmark completed in ${elapsedTime} seconds.`);

  process.exit();
})();
