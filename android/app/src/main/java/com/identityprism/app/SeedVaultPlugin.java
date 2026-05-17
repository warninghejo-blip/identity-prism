package com.identityprism.app;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.solanamobile.seedvault.WalletContractV1;

@CapacitorPlugin(name = "SeedVault")
public class SeedVaultPlugin extends Plugin {
  @PluginMethod
  public void isAvailable(PluginCall call) {
    Context ctx = getContext();
    boolean available = false;
    try {
      // Probe via content provider authority
      available = ctx.getPackageManager()
          .resolveContentProvider(WalletContractV1.AUTHORITY_WALLET_PROVIDER, 0) != null;
    } catch (Throwable t) {
      available = false;
    }
    JSObject ret = new JSObject();
    ret.put("available", available);
    call.resolve(ret);
  }

  @PluginMethod
  public void authorize(PluginCall call) {
    // STAGE B will implement intent + state machine + callback
    call.unimplemented("Stage B");
  }

  @PluginMethod
  public void signMessage(PluginCall call) {
    call.unimplemented("Stage B");
  }

  @PluginMethod
  public void signTransaction(PluginCall call) {
    call.unimplemented("Stage B");
  }

  @PluginMethod
  public void deauthorize(PluginCall call) {
    call.unimplemented("Stage B");
  }
}
