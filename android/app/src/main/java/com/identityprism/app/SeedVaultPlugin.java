package com.identityprism.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

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

  private long pendingAuthToken = -1;

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
      Uri derivationPath = Uri.parse("bip32:/m/44'/501'/0'/0'");
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
      ret.put("derivationPath", resolved != null ? resolved.toString() : "bip32:/m/44'/501'/0'/0'");
      call.resolve(ret);
    } catch (Exception t) {
      call.reject("onRequestPublicKeysResult failed: " + t.getMessage(), t);
    }
  }

  // ---------------- Sign message ----------------
  @PluginMethod
  public void signMessage(PluginCall call) {
    try {
      Long authTokenObj = call.getLong("authToken");
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
      Long authTokenObj = call.getLong("authToken");
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
      Long authTokenObj = call.getLong("authToken");
      if (authTokenObj == null) {
        call.reject("Missing authToken");
        return;
      }
      try {
        Wallet.deauthorizeSeed(getContext(), authTokenObj);
      } catch (Wallet.NotModifiedException nme) {
        // already deauthorized — treat as success
      }
      call.resolve();
    } catch (Exception t) {
      call.reject("deauthorize failed: " + t.getMessage(), t);
    }
  }
}
