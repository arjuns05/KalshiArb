/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Book` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Book_name_key" ON "Book"("name");
