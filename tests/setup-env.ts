process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/atlas_test";
process.env.AUTH_SECRET ??= "alleen-voor-tests";
