const { AccountModel } = require("../models/Account.model");
const { ATMmodel } = require("../models/ATMCard.model");
const { UserModel } = require("../models/User.model");
const ApiError = require("../utils/ApiError");
const random = require("random-int"); // removed destructuring with 'default'
const { Account_LIMIT, CARD_TYPE } = require("../utils/constant");
const { TransactionModel } = require("../models/Transactions.model");

class ATMCardService {
    static addNewCard = async (user, body) => {
        const exist_atm = await ATMmodel.findOne({
            account: body.account,
            card_type: body.card_type
        });

        if (exist_atm) {
            throw new ApiError(400, "Card Already Exists");
        }

        const generateATMNO = () => {
            return (
                random(1000, 9999).toString() +
                random(1000, 9999).toString() +
                random(1000, 9999).toString() +
                random(1000, 9999).toString()
            );
        };

        const cvv_no = random(100, 999);
        const date = new Date();
        date.setMonth(date.getMonth() + 3); // expiry in 3 months
        const expiry = date;

        await ATMmodel.create({
            account: body.account,
            card_no: generateATMNO(),
            card_type: body.card_type,
            cvv: cvv_no,
            pin: body.pin,
            expiry: expiry,
            user
        });

        return {
            msg: "Card Generated :)"
        };
    };

    static getATMById = async (user, id) => {
        const atmCard = await ATMmodel.findById(id).select("-pin -user -account");
        return atmCard;
    };

    static withdrawalByATM = async (user, id, body) => {
        const user_exist = await UserModel.findById(user);
        const amount_req = Number(body.amount);

        if (!user_exist) {
            throw new ApiError(401, "Invalid User");
        }

        const atm_details = await ATMmodel.findById(id);
        if (!atm_details) {
            throw new ApiError(400, "ATM Card Details Not Found");
        }

        const account = await AccountModel.findById(atm_details.account);
        if (!account) {
            throw new ApiError(400, "Account Not Found");
        }

        // PIN verification
        if (parseInt(body.pin) !== atm_details.pin) {
            await TransactionModel.create({
                type: 'debit',
                account: account._id,
                user: user,
                isSuccess: false,
                amount: amount_req,
                remark: `Invalid PIN entered`
            });
            throw new ApiError(401, "Invalid PIN");
        }

        // Account limit check
        if (account.ac_type === 'current') {
            if (account.amount <= Account_LIMIT.current) {
                await TransactionModel.create({
                    type: 'debit',
                    account: account._id,
                    user: user,
                    isSuccess: false,
                    amount: amount_req,
                    remark: `Withdrawal blocked due to current account limit`
                });
                throw new ApiError(400, "Insufficient Balance by Limit");
            }
        }

        // Sufficient funds?
        if (amount_req >= account.amount) {
            await TransactionModel.create({
                type: 'debit',
                account: account._id,
                user: user,
                isSuccess: false,
                amount: amount_req,
                remark: `Withdrawal blocked due to insufficient funds`
            });
            throw new ApiError(400, "Insufficient Funds");
        }

        // Card limit check
        const cardLimits = CARD_TYPE[atm_details.card_type];
        if (!cardLimits) {
            throw new ApiError(400, "Invalid Card Type");
        }

        if (amount_req < cardLimits.min) {
            throw new ApiError(400, `Minimum withdrawal amount for ${atm_details.card_type} is ${cardLimits.min}`);
        }

        if (amount_req > cardLimits.max) {
            throw new ApiError(400, `Maximum withdrawal amount for ${atm_details.card_type} is ${cardLimits.max}`);
        }

        // Deduct balance
        await AccountModel.findByIdAndUpdate(account._id, {
            amount: account.amount - amount_req
        });

        // Log transaction
        await TransactionModel.create({
            type: 'debit',
            account: account._id,
            user: user,
            isSuccess: true,
            amount: amount_req,
            remark: `Amount withdrawn: ₹${amount_req}`
        });

        return {
            msg: "Amount Withdrawn"
        };
    };
}

module.exports = ATMCardService;
