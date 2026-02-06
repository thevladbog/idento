Pod::Spec.new do |spec|
    spec.name                     = 'shared'
    spec.version                  = '1.0'
    spec.homepage                 = 'https://github.com/yourusername/idento'
    spec.source                   = { :http=> ''}
    spec.authors                  = ''
    spec.license                  = ''
    spec.summary                  = 'Idento Shared KMP Module'
    spec.vendored_frameworks      = 'build/bin/iosSimulatorArm64/debugFramework/shared.framework'
    spec.libraries                = 'c++'
    spec.ios.deployment_target    = '14.0'
                
    spec.pod_target_xcconfig = {
        'KOTLIN_PROJECT_PATH' => ':shared',
        'PRODUCT_MODULE_NAME' => 'shared',
    }
end
