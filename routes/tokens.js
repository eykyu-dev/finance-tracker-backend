const express = require("express");
const escape = require("escape-html");
const jwt = require("jsonwebtoken");
require('dotenv').config();


const jwtSecret = process.env.JWT_SECRET;
const { plaidClient } = require("../plaid");
const { syncTransactions } = require("./transactions");

const db = require("../db");
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const router = express.Router();


const verifyTokenAndExtractUserId = require("./middleware/verifyTokenAndExtractUserId");

router.use(verifyTokenAndExtractUserId)

/**
 * Generates a link token to be used by the client
 */
router.post("/generate_link_token", async (req, res, next) => {
  try {
    const uuid = req.uuid
    const userObject = { client_user_id: uuid };
    const tokenResponse = await plaidClient.linkTokenCreate({
      user: userObject,
      products: ["transactions"],
      client_name: "otter-wallet",
      language: "en",
      country_codes: ["US"],
      webhook: WEBHOOK_URL,
    });
    res.json(tokenResponse.data);
  } catch (error) {
    console.log(`Running into an error!`);
    next(error);
  }
});

/**
 * Exchanges a public token for an access token. Then, fetches a bunch of
 * information about that item and stores it in our database
 */
router.post("/exchange_public_token", async (req, res, next) => {
  try {
    const uuid = req.uuid;
    const publicToken = escape(req.body.publicToken);

    const tokenResponse = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const tokenData = tokenResponse.data;
    await db.addItem(tokenData.item_id, uuid, tokenData.access_token);
    await populateBankName(tokenData.item_id, tokenData.access_token);
    await populateAccountNames(tokenData.access_token);

    /* Placeholder code to show that something works! */
    const identityResult = await plaidClient.identityGet({
      access_token: tokenData.access_token,
    });
    console.log(`Here's some info about the account holders:`);
    console.dir(identityResult.data, { depth: null, colors: true });

    res.json({ status: "success" });
  } catch (error) {
    console.log(`Running into an error!`);
    next(error);
  }
});



const populateBankName = async (item_id, access_token) => {
  try {
    const itemResponse = await plaidClient.itemGet({
      access_token: access_token,
    });
    const institutionId = itemResponse.data.item.institution_id;
    if (institutionId == null) {
      return;
    }
    const institutionResponse = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: ["US"],
    });
    const institutionName = institutionResponse.data.institution.name;
    await db.addBankNameForItem(item_id, institutionName);
  } catch (error) {
    console.log(`Ran into an error! ${error}`);
  }
};

const populateAccountNames = async (accessToken) => {
  try {
    const acctsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });
    const acctsData = acctsResponse.data;
    const itemId = acctsData.item.item_id;
    await Promise.all(
      acctsData.accounts.map(async (acct) => {
        await db.addAccount(acct.account_id, itemId, acct.name);
      })
    );
  } catch (error) {
    console.log(`Ran into an error! ${error}`);
  }
};

module.exports = router;