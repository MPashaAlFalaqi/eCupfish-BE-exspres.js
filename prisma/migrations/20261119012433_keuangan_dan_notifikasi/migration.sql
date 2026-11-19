/*
  Warnings:

  - You are about to drop the column `message` on the `notification` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `notification` table. All the data in the column will be lost.
  - You are about to drop the column `accountHolder` on the `sellerpayout` table. All the data in the column will be lost.
  - You are about to drop the column `accountNumber` on the `sellerpayout` table. All the data in the column will be lost.
  - You are about to drop the column `amount` on the `sellerpayout` table. All the data in the column will be lost.
  - You are about to drop the column `bankName` on the `sellerpayout` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `sellerpayout` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `sellerpayout` table. All the data in the column will be lost.
  - You are about to alter the column `status` on the `sellerpayout` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(13))`.
  - Added the required column `body` to the `Notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `category` to the `Notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `gatewayFee` to the `SellerPayout` table without a default value. This is not possible if the table is not empty.
  - Added the required column `grossAmount` to the `SellerPayout` table without a default value. This is not possible if the table is not empty.
  - Added the required column `netAmount` to the `SellerPayout` table without a default value. This is not possible if the table is not empty.
  - Added the required column `platformFee` to the `SellerPayout` table without a default value. This is not possible if the table is not empty.
  - Made the column `orderId` on table `sellerpayout` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `sellerpayout` DROP FOREIGN KEY `SellerPayout_sellerId_fkey`;

-- AlterTable
ALTER TABLE `notification` DROP COLUMN `message`,
    DROP COLUMN `type`,
    ADD COLUMN `body` VARCHAR(191) NOT NULL,
    ADD COLUMN `category` VARCHAR(191) NOT NULL,
    ADD COLUMN `href` VARCHAR(191) NOT NULL DEFAULT '/dashboard';

-- AlterTable
ALTER TABLE `sellerpayout` DROP COLUMN `accountHolder`,
    DROP COLUMN `accountNumber`,
    DROP COLUMN `amount`,
    DROP COLUMN `bankName`,
    DROP COLUMN `notes`,
    DROP COLUMN `updatedAt`,
    ADD COLUMN `gatewayFee` INTEGER NOT NULL,
    ADD COLUMN `grossAmount` INTEGER NOT NULL,
    ADD COLUMN `netAmount` INTEGER NOT NULL,
    ADD COLUMN `paidOutAt` DATETIME(3) NULL,
    ADD COLUMN `platformFee` INTEGER NOT NULL,
    ADD COLUMN `releaseAt` DATETIME(3) NULL,
    MODIFY `status` ENUM('IN_ESCROW', 'RELEASED', 'REFUNDED') NOT NULL DEFAULT 'IN_ESCROW',
    MODIFY `orderId` INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX `Notification_userId_isRead_createdAt_idx` ON `Notification`(`userId`, `isRead`, `createdAt`);

-- CreateIndex
CREATE INDEX `SellerPayout_sellerId_status_idx` ON `SellerPayout`(`sellerId`, `status`);

-- AddForeignKey
ALTER TABLE `SellerPayout` ADD CONSTRAINT `SellerPayout_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SellerPayout` ADD CONSTRAINT `SellerPayout_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
