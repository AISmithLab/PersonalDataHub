#import "PhotosModule.h"
#import <Photos/Photos.h>
#import <UIKit/UIKit.h>

@implementation PhotosModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(getPhotos:(NSInteger)limit
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  // iOS gates PhotosKit access behind NSPhotoLibraryUsageDescription; the OS prompt
  // fires on this first request, mirroring how Android's PermissionsAndroid flow works.
  [PHPhotoLibrary requestAuthorizationForAccessLevel:PHAccessLevelReadWrite
                                              handler:^(PHAuthorizationStatus status) {
    if (status != PHAuthorizationStatusAuthorized && status != PHAuthorizationStatusLimited) {
      reject(@"PERMISSION_DENIED", @"Photos access denied", nil);
      return;
    }

    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
      PHFetchOptions *options = [PHFetchOptions new];
      options.sortDescriptors = @[[NSSortDescriptor sortDescriptorWithKey:@"creationDate" ascending:NO]];
      PHFetchResult<PHAsset *> *assets = [PHAsset fetchAssetsWithMediaType:PHAssetMediaTypeImage options:options];

      NSMutableArray *photos = [NSMutableArray new];
      NSDateFormatter *formatter = [NSDateFormatter new];
      formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss'Z'";
      formatter.timeZone = [NSTimeZone timeZoneWithAbbreviation:@"UTC"];
      formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];

      PHImageManager *manager = [PHImageManager defaultManager];
      PHImageRequestOptions *imgOptions = [PHImageRequestOptions new];
      imgOptions.synchronous = YES;
      imgOptions.deliveryMode = PHImageRequestOptionsDeliveryModeFastFormat;
      imgOptions.networkAccessAllowed = NO;

      NSInteger count = 0;
      for (PHAsset *asset in assets) {
        if (count >= limit) break;

        NSString *timestamp = asset.creationDate ? [formatter stringFromDate:asset.creationDate] : @"";
        NSString *localId = asset.localIdentifier ?: @"";

        __block NSString *dataUrl = @"";
        [manager requestImageForAsset:asset
                            targetSize:CGSizeMake(270, 270)
                           contentMode:PHImageContentModeAspectFit
                               options:imgOptions
                         resultHandler:^(UIImage * _Nullable image, NSDictionary * _Nullable info) {
          if (image) {
            NSData *jpeg = UIImageJPEGRepresentation(image, 0.75);
            if (jpeg) {
              dataUrl = [NSString stringWithFormat:@"data:image/jpeg;base64,%@",
                         [jpeg base64EncodedStringWithOptions:0]];
            }
          }
        }];

        [photos addObject:@{
          @"id": localId,
          @"title": [NSString stringWithFormat:@"%@.jpg", localId],
          @"album": @"Camera Roll",
          @"timestamp": timestamp,
          @"date": timestamp,
          @"width": @(asset.pixelWidth > 0 ? asset.pixelWidth : 1080),
          @"height": @(asset.pixelHeight > 0 ? asset.pixelHeight : 1080),
          @"uri": localId,
          @"dataUrl": dataUrl,
        }];
        count++;
      }

      resolve(photos);
    });
  }];
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
