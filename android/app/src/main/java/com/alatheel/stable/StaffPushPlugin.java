package com.alatheel.stable;
import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(name="StaffPush", permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class StaffPushPlugin extends Plugin {
    private String pendingAlert="", pendingUser="";
    @Override public void load(){StaffMessagingService.channels(getContext());capture(getActivity().getIntent());}
    private boolean allowed(){return NotificationManagerCompat.from(getContext()).areNotificationsEnabled() && (Build.VERSION.SDK_INT<33 || getPermissionState("notifications")==PermissionState.GRANTED);}
    private android.content.SharedPreferences prefs(){return getContext().getSharedPreferences("alatheel_staff_push",0);}
    private void capture(Intent intent){if(intent==null)return;String id=intent.getStringExtra("alatheelAlertId"),uid=intent.getStringExtra("alatheelAlertUser");if(id!=null&&uid!=null&&id.matches("[a-f0-9]{40}")){pendingAlert=id;pendingUser=uid;JSObject value=new JSObject();value.put("alertId",id);value.put("userId",uid);notifyListeners("open",value,true);intent.removeExtra("alatheelAlertId");intent.removeExtra("alatheelAlertUser");}}
    @Override protected void handleOnNewIntent(Intent intent){capture(intent);}
    @PluginMethod public void pending(PluginCall call){JSObject value=new JSObject();value.put("alertId",pendingAlert);value.put("userId",pendingUser);pendingAlert="";pendingUser="";call.resolve(value);}
    @PluginMethod public void status(PluginCall call){JSObject value=new JSObject();value.put("enabled",allowed()&&prefs().getBoolean("enabled",false));call.resolve(value);}
    @PluginMethod public void session(PluginCall call){String uid=call.getString("userId",""),device=call.getString("deviceId","");prefs().edit().putString("userId",uid).putString("deviceId",device).apply();call.resolve();}
    @PluginMethod public void enable(PluginCall call){if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"permissionResult");return;}finishEnable(call);}
    @PermissionCallback private void permissionResult(PluginCall call){finishEnable(call);}
    private void finishEnable(PluginCall call){if(!allowed()){JSObject result=new JSObject();result.put("enabled",false);call.resolve(result);return;}prefs().edit().putBoolean("enabled",true).apply();token(call);}
    @PluginMethod public void token(PluginCall call){FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task->{if(!task.isSuccessful()){call.reject("تعذر تفعيل الإشعارات؛ أعد المحاولة");return;}JSObject result=new JSObject();result.put("enabled",allowed()&&prefs().getBoolean("enabled",false));result.put("token",task.getResult());call.resolve(result);});}
    @PluginMethod public void disable(PluginCall call){prefs().edit().putBoolean("enabled",false).putString("userId","").apply();NotificationManagerCompat.from(getContext()).cancelAll();call.resolve();}
}
