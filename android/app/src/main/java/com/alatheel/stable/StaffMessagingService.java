package com.alatheel.stable;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.Executors;

public class StaffMessagingService extends FirebaseMessagingService {
    private static final java.util.concurrent.ExecutorService TOKEN_WORKER=Executors.newSingleThreadExecutor();
    public static void channels(Context context){if(Build.VERSION.SDK_INT>=26){NotificationManager manager=context.getSystemService(NotificationManager.class);String[] ids={"collection_due","stock_low","stock_empty"},names={"استحقاق التحصيل","انخفاض المخزون","نفاد المخزون"};for(int i=0;i<ids.length;i++)manager.createNotificationChannel(new NotificationChannel("alatheel_"+ids[i],names[i],NotificationManager.IMPORTANCE_DEFAULT));}}
    @Override public void onMessageReceived(@NonNull RemoteMessage message){
        Map<String,String> data=message.getData();String id=data.get("alertId"),uid=data.get("userId"),kind=data.get("kind");
        SharedPreferences p=getSharedPreferences("alatheel_staff_push",0);
        String seen=p.getString("seen","");
        if(!StaffPushPolicy.accept(id,uid,p.getString("userId",""),kind,p.getBoolean("enabled",false),seen))return;
        if(!NotificationManagerCompat.from(this).areNotificationsEnabled())return;
        channels(this);Intent intent=new Intent(this,MainActivity.class).setAction("com.alatheel.stable.alert."+id).setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("alatheelAlertId",id).putExtra("alatheelAlertUser",uid);
        PendingIntent open=PendingIntent.getActivity(this,id.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b=new NotificationCompat.Builder(this,"alatheel_"+kind).setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle(data.getOrDefault("title","الأثيل")).setContentText(data.getOrDefault("body","")).setStyle(new NotificationCompat.BigTextStyle().bigText(data.getOrDefault("body",""))).setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        try{NotificationManagerCompat.from(this).notify(id,0,b.build());String next=seen+"|"+id+"|";if(next.length()>10000)next=next.substring(next.length()-8400);p.edit().putString("seen",next).apply();}catch(SecurityException ignored){}
    }
    @Override public void onNewToken(@NonNull String token){
        SharedPreferences p=getSharedPreferences("alatheel_staff_push",0);p.edit().putString("pendingToken",token).apply();
        final String uid=p.getString("userId",""),device=p.getString("deviceId","");
        if(!p.getBoolean("enabled",false)||uid.isEmpty()||device.isEmpty())return;
        var user=FirebaseAuth.getInstance().getCurrentUser();if(user==null||!uid.equals(user.getUid()))return;
        user.getIdToken(false).addOnSuccessListener(result->TOKEN_WORKER.execute(()->{
            if(!uid.equals(p.getString("userId",""))||!p.getBoolean("enabled",false))return;
            HttpURLConnection c=null;try{
                c=(HttpURLConnection)new URL("https://us-central1-gen-lang-client-0145196991.cloudfunctions.net/updatePushDevice").openConnection();c.setRequestMethod("POST");c.setConnectTimeout(10000);c.setReadTimeout(10000);c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");c.setRequestProperty("Authorization","Bearer "+result.getToken());
                JSONObject data=new JSONObject().put("deviceId",device).put("token",token).put("enabled",true);
                byte[] bytes=new JSONObject().put("data",data).toString().getBytes(StandardCharsets.UTF_8);try(var out=c.getOutputStream()){out.write(bytes);}if(c.getResponseCode()==200)p.edit().remove("pendingToken").apply();
            }catch(Exception ignored){}finally{if(c!=null)c.disconnect();}
        }));
    }
}
