require 'xcodeproj'

project_path = 'iosApp.xcodeproj'
project = Xcodeproj::Project.new(project_path)

# Create main target
target = project.new_target(:application, 'iosApp', :ios, '14.0')

# Add source files
app_group = project.new_group('iosApp')
app_group.new_reference('iosApp/iOSApp.swift')
app_group.new_reference('iosApp/Info.plist')

# Add files to target
project.targets.first.add_file_references([
  app_group.files.first
])

# Set Info.plist path
target.build_configurations.each do |config|
  config.build_settings['INFOPLIST_FILE'] = 'iosApp/Info.plist'
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.idento.iosapp'
  config.build_settings['SWIFT_VERSION'] = '5.0'
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '14.0'
end

project.save
