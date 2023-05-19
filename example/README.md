# Example

## Add a new user

To add a new user, send a POST request to the `/users` endpoint with the user details in the request body. The user details should be provided as a JSON object containing the `name` and `age` properties.

```bash
curl -X POST -H "Content-Type: application/json" -d '{"name": "John Doe", "age": 25}' http://localhost:3000/users
```

## Retrieve all users

To retrieve all users, send a GET request to the `/users` endpoint.

```bash
curl http://localhost:3000/users
```

The server will respond with a JSON object containing the list of users.
