package com.identityprism.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.solanamobile.seedvault.PublicKeyResponse;
import com.solanamobile.seedvault.SigningRequest;
import com.solanamobile.seedvault.SigningResponse;
import com.solanamobile.seedvault.Wallet;
import com.solanamobile.seedvault.WalletContractV1;

import java.util.ArrayList;

@CapacitorPlugin(
    name = "SeedVault",
    permissions = {
        @Permission(
            alias = "seedvault",
            strings = { "com.solanamobile.seedvault.ACCESS_SEED_VAULT" }
        )
    }
)
public class SeedVaultPlugin extends Plugin {

  private static final int MAX_DERIVED_ACCOUNTS = 2;
  private static final String DEFAULT_SEED_NAME = "Seeker Seed";

  private long pendingAuthToken = -1;
  private String pendingDerivationPath = "bip32:/m/44'/501'/0'/0'";

  private Uri derivationPathForIndex(int accountIndex) {
    int safeIndex = accountIndex >= 0 && accountIndex < MAX_DERIVED_ACCOUNTS ? accountIndex : 0;
    return Uri.parse("bip32:/m/44'/501'/" + safeIndex + "'/0'");
  }

  private Long readAuthorizedSeedToken() {
    Cursor cursor = null;
    try {
      cursor = Wallet.getAuthorizedSeeds(
          getContext(),
          WalletContractV1.AUTHORIZED_SEEDS_ALL_COLUMNS,
          WalletContractV1.AUTHORIZED_SEEDS_AUTH_PURPOSE,
          WalletContractV1.PURPOSE_SIGN_SOLANA_TRANSACTION
      );
      if (cursor == null) return null;
      int tokenColumn = cursor.getColumnIndex(WalletContractV1.AUTHORIZED_SEEDS_AUTH_TOKEN);
      if (tokenColumn < 0) return null;
      while (cursor.moveToNext()) {
        long token = cursor.getLong(tokenColumn);
        if (token > 0) return token;
      }
    } catch (Throwable ignored) {
      return null;
    } finally {
      if (cursor != null) {
        cursor.close();
      }
    }
    return null;
  }

  private Long ensureAuthToken() {
    if (this.pendingAuthToken > 0) return this.pendingAuthToken;
    Long restored = readAuthorizedSeedToken();
    if (restored != null && restored > 0) {
      this.pendingAuthToken = restored;
      return restored;
    }
    return null;
  }

  private Long readAuthToken(PluginCall call) {
    Long token = call.getLong("authToken");
    if (token != null) return token;

    try {
      Object raw = call.getData() != null ? call.getData().opt("authToken") : null;
      if (raw instanceof Number) return ((Number) raw).longValue();
      if (raw instanceof String) {
        String text = ((String) raw).trim();
        if (!text.isEmpty()) return Long.parseLong(text);
      }
    } catch (Exception ignored) {
      // Fall through to the currently authorized token.
    }

    return ensureAuthToken();
  }

  @PluginMethod
  public void isAvailable(PluginCall call) {
    Context ctx = getContext();
    boolean available = false;
    try {
      available = ctx.getPackageManager()
          .resolveContentProvider(WalletContractV1.AUTHORITY_WALLET_PROVIDER, 0) != null;
    } catch (Throwable t) {
      available = false;
    }
    JSObject ret = new JSObject();
    ret.put("available", available);
    call.resolve(ret);
  }

  // ---------------- Authorize (chained) ----------------
  @PluginMethod
  public void authorize(PluginCall call) {
    if (getPermissionState("seedvault") != PermissionState.GRANTED) {
      call.setKeepAlive(true);
      requestPermissionForAlias("seedvault", call, "onSeedVaultPermissionResult");
      return;
    }
    startAuthorizeIntent(call);
  }

  @PermissionCallback
  private void onSeedVaultPermissionResult(PluginCall call) {
    if (getPermissionState("seedvault") != PermissionState.GRANTED) {
      call.reject("Seed Vault permission denied");
      return;
    }
    startAuthorizeIntent(call);
  }

  private void startAuthorizeIntent(PluginCall call) {
    try {
      Long existingToken = ensureAuthToken();
      if (existingToken != null && existingToken > 0) {
        Integer requestedIndex = call.getInt("accountIndex", 0);
        Uri derivationPath = derivationPathForIndex(requestedIndex != null ? requestedIndex : 0);
        this.pendingDerivationPath = derivationPath.toString();
        ArrayList<Uri> paths = new ArrayList<>();
        paths.add(derivationPath);
        Intent pkIntent = Wallet.requestPublicKeys(getContext(), existingToken, paths);
        call.setKeepAlive(true);
        startActivityForResult(call, pkIntent, "onPubKeyResult");
        return;
      }
      Intent intent = Wallet.authorizeSeed(getContext(), WalletContractV1.PURPOSE_SIGN_SOLANA_TRANSACTION);
      call.setKeepAlive(true);
      startActivityForResult(call, intent, "onAuthorizeResult");
    } catch (Exception t) {
      call.reject("authorizeSeed failed: " + t.getMessage(), t);
    }
  }

  @ActivityCallback
  public void onAuthorizeResult(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK) {
      call.reject("Authorize cancelled (rc=" + result.getResultCode() + ")");
      return;
    }
    try {
      long authToken = Wallet.onAuthorizeSeedResult(result.getResultCode(), result.getData());
      this.pendingAuthToken = authToken;
      Integer requestedIndex = call.getInt("accountIndex", 0);
      Uri derivationPath = derivationPathForIndex(requestedIndex != null ? requestedIndex : 0);
      this.pendingDerivationPath = derivationPath.toString();
      ArrayList<Uri> paths = new ArrayList<>();
      paths.add(derivationPath);
      Intent pkIntent = Wallet.requestPublicKeys(getContext(), authToken, paths);
      startActivityForResult(call, pkIntent, "onPubKeyResult");
    } catch (Exception t) {
      call.reject("onAuthorizeSeedResult failed: " + t.getMessage(), t);
    }
  }

  @ActivityCallback
  public void onPubKeyResult(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK) {
      call.reject("Get public key cancelled (rc=" + result.getResultCode() + ")");
      return;
    }
    try {
      ArrayList<PublicKeyResponse> responses =
          Wallet.onRequestPublicKeysResult(result.getResultCode(), result.getData());
      if (responses == null || responses.isEmpty()) {
        call.reject("No public keys returned");
        return;
      }
      PublicKeyResponse pkr = responses.get(0);
      String address;
      try {
        address = pkr.getPublicKeyEncoded();
      } catch (PublicKeyResponse.KeyNotValidException knve) {
        call.reject("Public key not valid: " + knve.getMessage(), knve);
        return;
      }
      JSObject ret = new JSObject();
      ret.put("authToken", this.pendingAuthToken);
      ret.put("address", address);
      Uri resolved = pkr.resolvedDerivationPath;
      ret.put("derivationPath", resolved != null ? resolved.toString() : this.pendingDerivationPath);
      call.resolve(ret);
    } catch (Exception t) {
      call.reject("onRequestPublicKeysResult failed: " + t.getMessage(), t);
    }
  }

  // ---------------- Authorized accounts ----------------
  @PluginMethod
  public void getAuthorizedAccounts(PluginCall call) {
    Long authToken = ensureAuthToken();
    if (authToken == null || authToken <= 0) {
      JSObject ret = new JSObject();
      ret.put("accounts", new JSArray());
      call.resolve(ret);
      return;
    }
    try {
      ArrayList<Uri> paths = new ArrayList<>();
      for (int i = 0; i < MAX_DERIVED_ACCOUNTS; i++) {
        paths.add(derivationPathForIndex(i));
      }
      call.setKeepAlive(true);
      Intent pkIntent = Wallet.requestPublicKeys(getContext(), authToken, paths);
      startActivityForResult(call, pkIntent, "onAuthorizedAccountsResult");
    } catch (Exception t) {
      call.reject("getAuthorizedAccounts failed: " + t.getMessage(), t);
    }
  }

  @ActivityCallback
  public void onAuthorizedAccountsResult(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK) {
      call.reject("Get authorized accounts cancelled (rc=" + result.getResultCode() + ")");
      return;
    }
    try {
      ArrayList<PublicKeyResponse> responses =
          Wallet.onRequestPublicKeysResult(result.getResultCode(), result.getData());
      JSArray accounts = new JSArray();
      if (responses != null) {
        for (int i = 0; i < responses.size(); i++) {
          PublicKeyResponse pkr = responses.get(i);
          String address;
          boolean isValid = true;
          try {
            address = pkr.getPublicKeyEncoded();
          } catch (PublicKeyResponse.KeyNotValidException knve) {
            address = "";
            isValid = false;
          }
          Uri resolved = pkr.resolvedDerivationPath;
          JSObject account = new JSObject();
          account.put("authToken", this.pendingAuthToken);
          account.put("seedName", DEFAULT_SEED_NAME);
          account.put("accountName", "Account " + (i + 1));
          account.put("address", address);
          account.put("derivationPath", resolved != null ? resolved.toString() : derivationPathForIndex(i).toString());
          account.put("isUserWallet", i == 0);
          account.put("isValid", isValid);
          accounts.put(account);
        }
      }
      JSObject ret = new JSObject();
      ret.put("accounts", accounts);
      call.resolve(ret);
    } catch (Exception t) {
      call.reject("onAuthorizedAccountsResult failed: " + t.getMessage(), t);
    }
  }

  // ---------------- Sign message ----------------
  @PluginMethod
  public void signMessage(PluginCall call) {
    try {
      Long authTokenObj = readAuthToken(call);
      if (authTokenObj == null) {
        call.reject("Missing authToken");
        return;
      }
      String messageB64 = call.getString("message");
      if (messageB64 == null) {
        call.reject("Missing message (base64)");
        return;
      }
      String derivPath = call.getString("derivationPath", "bip32:/m/44'/501'/0'/0'");
      byte[] msgBytes = Base64.decode(messageB64, Base64.DEFAULT);
      ArrayList<Uri> paths = new ArrayList<>();
      paths.add(Uri.parse(derivPath));
      ArrayList<SigningRequest> requests = new ArrayList<>();
      requests.add(new SigningRequest(msgBytes, paths));
      Intent intent = Wallet.signMessages(getContext(), authTokenObj, requests);
      call.setKeepAlive(true);
      startActivityForResult(call, intent, "onSignMessageResult");
    } catch (Exception t) {
      call.reject("signMessage failed: " + t.getMessage(), t);
    }
  }

  @ActivityCallback
  public void onSignMessageResult(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK) {
      call.reject("Sign message cancelled (rc=" + result.getResultCode() + ")");
      return;
    }
    try {
      ArrayList<SigningResponse> responses =
          Wallet.onSignMessagesResult(result.getResultCode(), result.getData());
      if (responses == null || responses.isEmpty()) {
        call.reject("No signing responses");
        return;
      }
      SigningResponse sr = responses.get(0);
      if (sr.getSignatures() == null || sr.getSignatures().isEmpty()) {
        call.reject("Empty signatures list");
        return;
      }
      byte[] sigBytes = sr.getSignatures().get(0);
      String sigB64 = Base64.encodeToString(sigBytes, Base64.NO_WRAP);
      JSObject ret = new JSObject();
      ret.put("signature", sigB64);
      call.resolve(ret);
    } catch (Exception t) {
      call.reject("onSignMessagesResult failed: " + t.getMessage(), t);
    }
  }

  // ---------------- Sign transaction ----------------
  @PluginMethod
  public void signTransaction(PluginCall call) {
    try {
      Long authTokenObj = readAuthToken(call);
      if (authTokenObj == null) {
        call.reject("Missing authToken");
        return;
      }
      String txB64 = call.getString("transaction");
      if (txB64 == null) {
        call.reject("Missing transaction (base64)");
        return;
      }
      String derivPath = call.getString("derivationPath", "bip32:/m/44'/501'/0'/0'");
      byte[] txBytes = Base64.decode(txB64, Base64.DEFAULT);
      ArrayList<Uri> paths = new ArrayList<>();
      paths.add(Uri.parse(derivPath));
      ArrayList<SigningRequest> requests = new ArrayList<>();
      requests.add(new SigningRequest(txBytes, paths));
      Intent intent = Wallet.signTransactions(getContext(), authTokenObj, requests);
      call.setKeepAlive(true);
      startActivityForResult(call, intent, "onSignTransactionResult");
    } catch (Exception t) {
      call.reject("signTransaction failed: " + t.getMessage(), t);
    }
  }

  @ActivityCallback
  public void onSignTransactionResult(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK) {
      call.reject("Sign transaction cancelled (rc=" + result.getResultCode() + ")");
      return;
    }
    try {
      ArrayList<SigningResponse> responses =
          Wallet.onSignTransactionsResult(result.getResultCode(), result.getData());
      if (responses == null || responses.isEmpty()) {
        call.reject("No signing responses");
        return;
      }
      SigningResponse sr = responses.get(0);
      if (sr.getSignatures() == null || sr.getSignatures().isEmpty()) {
        call.reject("Empty signatures list");
        return;
      }
      byte[] sigBytes = sr.getSignatures().get(0);
      JSObject ret = new JSObject();
      ret.put("signature", Base64.encodeToString(sigBytes, Base64.NO_WRAP));
      call.resolve(ret);
    } catch (Exception t) {
      call.reject("onSignTransactionsResult failed: " + t.getMessage(), t);
    }
  }

  // ---------------- Deauthorize ----------------
  @PluginMethod
  public void deauthorize(PluginCall call) {
    try {
      Long authTokenObj = readAuthToken(call);
      if (authTokenObj == null) {
        call.reject("Missing authToken");
        return;
      }
      try {
        Wallet.deauthorizeSeed(getContext(), authTokenObj);
      } catch (Wallet.NotModifiedException nme) {
        // already deauthorized — treat as success
      }
      if (this.pendingAuthToken == authTokenObj) {
        this.pendingAuthToken = -1;
        this.pendingDerivationPath = "bip32:/m/44'/501'/0'/0'";
      }
      call.resolve();
    } catch (Exception t) {
      call.reject("deauthorize failed: " + t.getMessage(), t);
    }
  }
}
