package com.alatheel.stable;
import static org.junit.Assert.*;
import org.junit.Test;

public class StaffPushPolicyTest {
    private final String id="a".repeat(40);
    @Test public void acceptsEachApprovedKindForTheActiveUser(){for(String kind:new String[]{"collection_due","stock_low","stock_empty","app_update"})assertTrue(StaffPushPolicy.accept(id,"staff","staff",kind,true,""));}
    @Test public void rejectsDisabledDevicesAndAnotherAccountsQueuedMessage(){assertFalse(StaffPushPolicy.accept(id,"old-user","new-user","stock_low",true,""));assertFalse(StaffPushPolicy.accept(id,"staff","staff","stock_low",false,""));assertFalse(StaffPushPolicy.accept(id,"","","stock_low",true,""));}
    @Test public void providerRetriesDoNotDisplayTheSameEventTwice(){assertFalse(StaffPushPolicy.accept(id,"staff","staff","collection_due",true,"|"+id+"|"));assertTrue(StaffPushPolicy.accept("b".repeat(40),"staff","staff","collection_due",true,"|"+id+"|"));}
    @Test public void rejectsMalformedDeepLinksAndUnexpectedKinds(){assertFalse(StaffPushPolicy.accept("../other-user","staff","staff","stock_low",true,""));assertFalse(StaffPushPolicy.accept(null,"staff","staff","stock_low",true,""));assertFalse(StaffPushPolicy.accept(id,"staff","staff","invitation",true,""));}
}
