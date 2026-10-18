package com.alatheel.stable;

/** Device association and replay policy, shared by the background receiver and its tests. */
public final class StaffPushPolicy {
    private StaffPushPolicy() {}
    public static boolean accept(String id,String recipient,String currentUser,String kind,boolean enabled,String seen){
        return enabled && id!=null && id.matches("[a-f0-9]{40}")
            && recipient!=null && !recipient.isEmpty() && recipient.equals(currentUser)
            && ("collection_due".equals(kind)||"stock_low".equals(kind)||"stock_empty".equals(kind)||"app_update".equals(kind))
            && (seen==null||!seen.contains("|"+id+"|"));
    }
}
