#import "ContactsModule.h"
#import <Contacts/Contacts.h>

@implementation ContactsModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(getContacts:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  CNContactStore *store = [CNContactStore new];
  // iOS has no separate "request permission" API like Android — the OS prompt
  // fires on first access request, gated by NSContactsUsageDescription in Info.plist.
  [store requestAccessForEntityType:CNEntityTypeContacts
                   completionHandler:^(BOOL granted, NSError * _Nullable accessError) {
    if (!granted) {
      reject(@"PERMISSION_DENIED", accessError.localizedDescription ?: @"Contacts access denied", accessError);
      return;
    }

    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
      NSArray *keys = @[CNContactGivenNameKey, CNContactFamilyNameKey, CNContactPhoneNumbersKey];
      CNContactFetchRequest *request = [[CNContactFetchRequest alloc] initWithKeysToFetch:keys];
      NSMutableArray *contacts = [NSMutableArray new];

      NSError *error = nil;
      BOOL ok = [store enumerateContactsWithFetchRequest:request
                                                    error:&error
                                               usingBlock:^(CNContact * _Nonnull contact, BOOL * _Nonnull stop) {
        NSString *name = [CNContactFormatter stringFromContact:contact style:CNContactFormatterStyleFullName];
        if (name == nil) name = @"";
        for (CNLabeledValue<CNPhoneNumber *> *labeledValue in contact.phoneNumbers) {
          [contacts addObject:@{
            @"name": name,
            @"number": labeledValue.value.stringValue ?: @"",
          }];
        }
      }];

      if (!ok) {
        reject(@"READ_CONTACTS_ERROR", error.localizedDescription ?: @"Read contacts failed", error);
        return;
      }
      resolve(contacts);
    });
  }];
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
