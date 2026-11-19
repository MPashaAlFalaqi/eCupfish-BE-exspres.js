/*
  Warnings:

  - A unique constraint covering the columns `[orderId]` on the table `SellerPayout` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `sellerpayout` ADD COLUMN `orderId` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `SellerPayout_orderId_key` ON `SellerPayout`(`orderId`);
