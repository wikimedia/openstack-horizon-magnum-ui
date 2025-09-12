/**
 * Copyright 2015 Cisco Systems, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may obtain
 * a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 */

(function() {
  'use strict';

  /**
   * @ngdoc overview
   * @name horizon.dashboard.container-infra.clusters.workflow
   * @ngModule
   *
   * @description
   * Provides business logic for Cluster creation workflow, including data model,
   * UI form schema and configuration, fetching and processing of required data.
   */
  angular
    .module('horizon.dashboard.container-infra.clusters')
    .factory(
      'horizon.dashboard.container-infra.clusters.workflow',
      ClusterWorkflow);

  ClusterWorkflow.$inject = [
    '$q',
    'horizon.dashboard.container-infra.basePath',
    'horizon.framework.util.i18n.gettext',
    'horizon.app.core.openstack-service-api.magnum',
    'horizon.app.core.openstack-service-api.neutron',
    'horizon.app.core.openstack-service-api.nova'
  ];

  // comma-separated key=value with optional space after comma
  var REGEXP_KEY_VALUE = /^(\w+=[^,]+,?\s?)+$/;

  // Comma-separated CIDR list. Allows lots of variation to include v4 and v6.
  var REGEXP_CIDR_LIST = /^[a-f0-9\.:]+\/[0-9]+(,\s?[a-f0-9\.:]+\/[0-9]+)*$/;

  // Object name, must start with alphabetical character.
  var REGEXP_CLUSTER_NAME = /^[a-zA-Z][a-zA-Z0-9_\-\.]*$/;

  function ClusterWorkflow($q, basePath, gettext, magnum, neutron, nova) {
    var workflow = {
      init: init
    };

    function init(title, $scope) {
      var schema, form;

      var fixedSubnetsInitial = gettext('Choose an existing subnet');
      // Default <option>s; will be shown in selector as a placeholder
      var templateTitleMap = [{value: '', name: gettext('Choose a Cluster Template') }];
      var availabilityZoneTitleMap = [{value: '',
        name: gettext('Choose an Availability Zone')}];
      var keypairsTitleMap = [{value: '', name: gettext('Choose a Keypair')}];
      var masterFlavorTitleMap = [{value: '',
        name: gettext('Choose a Flavor for the Control Plane nodes')}];
      var workerFlavorTitleMap = [{value: '',
        name: gettext('Choose a Flavor for the Worker nodes')}];
      var networkTitleMap = [{value: '', name: gettext('Choose an existing network')}];
      var subnetTitleMap = [{value: '', name: fixedSubnetsInitial}];
      var ingressTitleMap = [{value: '', name: gettext('Choose an ingress controller')}];

      var addonsTitleMap = [];

      var MODEL_DEFAULTS = getModelDefaults();
      var model = getModelDefaults();

      schema = {
        type: 'object',
        properties: {
          'name': { type: 'string' },
          'cluster_template_id': { type: 'string' },
          'availability_zone': { type: 'string' },
          'keypair': { type: 'string' },
          'addons': {
            type: 'array',
            items: { type: 'object' },
            minItems: 0
          },

          'master_count': {
            type: 'number',
            minimum: 1,
            maximum: 7,
          },
          'master_flavor_id': { type: 'string' },
          'node_count': {
            type: 'number',
            minimum: 0
          },
          'flavor_id': { type: 'string' },
          'auto_scaling_enabled': { type: 'boolean' },
          'min_node_count': {
            type: 'number',
            minimum: 0
          },
          'max_node_count': { type: 'number' },

          'master_lb_enabled': { type: 'boolean' },
          'create_network': { type: 'boolean' },
          'fixed_network': { type: 'string' },
          'fixed_subnet': { type: 'string' },
          'master_lb_floating_ip_enabled': { type: 'boolean' },
          'api_master_lb_allowed_cidrs': { type: 'string' },
          'ingress_controller': { type: 'object' },

          'auto_healing_enabled': { type: 'boolean' },

          'labels': { type: 'string' },
          'override_labels': { type: 'boolean' }
        }
      };

      var formMasterCount = {
        key: 'master_count',
        title: gettext('Number of Control Plane nodes'),
        placeholder: gettext('The number of Control Plane nodes for the cluster'),
        required: true,
        validationMessage: {
          'mustBeUnevenNumber': 'Supported control plane sizes are 1, 3, 5 or 7.'
        },
        $validators: {
          mustBeUnevenNumber: function(value) {
            return value % 2 !== 0;
          }
        }
      };

      // Disable the Master Count field, if only a single master is allowed
      var isSingleMasterNodeWatcher = $scope.$watch(
        function() { return model.isSingleMasterNode; },
        function(isSingle) {
          if (typeof isSingle !== 'undefined') {
            formMasterCount.readonly = isSingle;
          }
        },
        true);

      form = [
        {
          type:'tabs',
          tabs: [
            {
              title: gettext('Details'),
              help: basePath + 'clusters/workflow/details.help.html',
              type: 'section',
              htmlClass: 'row',
              required: true,
              items: [
                {
                  type: 'section',
                  htmlClass: 'col-md-8',
                  items: [
                    {
                      key: 'name',
                      title: gettext('Cluster Name'),
                      placeholder: gettext('Name of the cluster'),
                      required: true,
                      help: "Text",
                      validationMessage: {
                        'invalidFormat': 'Cluster name must begin with an alphabetical ' +
                                         'character and only contain alphanumeric, underscore, ' +
                                         'dash and fullstop characters.'
                      },
                      $validators: {
                        invalidFormat: function(value) {
                          return REGEXP_CLUSTER_NAME.test(value);
                        }
                      }
                    },
                    {
                      key: 'cluster_template_id',
                      type: 'select',
                      title: gettext('Cluster Template'),
                      titleMap: templateTitleMap,
                      required: true
                    },
                    // Details of the chosen Cluster Template
                    {
                      type: 'template',
                      templateUrl: basePath + 'clusters/workflow/cluster-template.html'
                    },
                    {
                      key: 'availability_zone',
                      type: 'select',
                      title: gettext('Availability Zone'),
                      titleMap: availabilityZoneTitleMap,
                      required: true
                    },
                    {
                      key: 'keypair',
                      type: 'select',
                      title: gettext('Keypair'),
                      titleMap: keypairsTitleMap,
                      required: true,
                    },
                    {
                      key: 'addons',
                      type: 'checkboxes',
                      title: gettext('Addon Software'),
                      disableSuccessState: true,
                      titleMap: addonsTitleMap
                    }
                  ]
                }
              ]
            },
            {
              title: gettext('Size'),
              help: basePath + 'clusters/workflow/size.help.html',
              type: 'section',
              htmlClass: 'row',
              required: true,
              items: [
                {
                  type: 'section',
                  htmlClass: 'col-md-8',
                  items: [
                    {
                      type: 'fieldset',
                      title: gettext('Control Plane Nodes'),
                      items: [
                        formMasterCount,
                        // Info message explaining why only single master node is enabled
                        {
                          type: 'template',
                          template: '<div class="alert alert-info">' +
                            '<span class="fa fa-info-circle"></span> ' +
                            gettext('The selected options do not support ' +
                            'multiple control plane nodes. A Kubernetes ' +
                            'API Load Balancer is required, and can be ' +
                            'enabled in the Network tab.') +
                            '</div>',
                          condition: 'model.isSingleMasterNode == true'
                        },
                        // Info message explaining why we allow only uneven numbers of
                        // control plane nodes.
                        {
                          type: 'template',
                          template: '<div class="alert alert-info">' +
                            '<span class="fa fa-info-circle"></span> ' +
                            gettext('Only an uneven number of control plane nodes are allowed. ' +
                              'This provides the best balance of fault tolerance and cost.') +
                            '</div>',
                          condition: 'false'
                        },
                        {
                          key: 'master_flavor_id',
                          title: gettext('Flavor of Control Plane Nodes'),
                          type: 'select',
                          titleMap: masterFlavorTitleMap,
                          required: true
                        }
                      ]
                    },
                    {
                      type: 'fieldset',
                      title: gettext('Worker Nodes'),
                      items: [
                        {
                          key: 'node_count',
                          title: gettext('Number of Worker Nodes'),
                          placeholder: gettext('The number of worker nodes for the cluster'),
                          required: true,
                          onChange: autosetScalingModelValues
                        },
                        {
                          key: 'flavor_id',
                          title: gettext('Flavor of Worker Nodes'),
                          type: 'select',
                          titleMap: workerFlavorTitleMap,
                          required: true
                        }
                      ]
                    },
                    {
                      type: 'fieldset',
                      title: gettext('Auto Scaling'),
                      items: [
                        {
                          key: 'auto_scaling_enabled',
                          type: 'checkbox',
                          title: gettext('Auto-scale Worker Nodes'),
                          onChange: function(isAutoScaling) {
                            // Reset dependant model fields to defaults first
                            model.min_node_count = MODEL_DEFAULTS.min_node_count;
                            model.max_node_count = MODEL_DEFAULTS.max_node_count;

                            if (isAutoScaling) { autosetScalingModelValues(); }
                          }
                        },
                        {
                          key: 'min_node_count',
                          title: gettext('Minimum Number of Worker Nodes'),
                          placeholder: gettext('Minimum Number of Worker Nodes'),
                          validationMessage: {
                            101: gettext('You cannot auto-scale to less than ' +
                              'a single Worker Node.'),
                            103: gettext('The minimum number of Worker Nodes a ' +
                              'new cluster can auto scale to cannot exceed the ' +
                              'total amount of Worker Nodes.'),
                            maximumExceeded: gettext('A minimum number of Worker ' +
                              'Nodes cannot be higher than the default number of Worker Nodes.')
                          },
                          $validators: {
                            maximumExceeded: function(minNodeCount) {
                              return !model.node_count || minNodeCount <= model.node_count;
                            }
                          },
                          condition: 'model.auto_scaling_enabled === true',
                          required: true
                        },
                        {
                          key: 'max_node_count',
                          title: gettext('Maximum number of Worker Nodes'),
                          placeholder: gettext('Maximum number of Worker Nodes'),
                          validationMessage: {
                            101: gettext('The maximum number of Worker Nodes a new cluster ' +
                              'can auto-scale to cannot be less than the total amount of ' +
                              'Worker Nodes.'),
                            minimumExceeded: gettext('The maximum number of Worker Nodes cannot ' +
                              'be less than the default number of Worker Nodes and 1.')
                          },
                          $validators: {
                            minimumExceeded: function(maxNodeCount) {
                              return maxNodeCount > 0 && (!model.node_count ||
                                maxNodeCount >= model.node_count);
                            }
                          },
                          condition: 'model.auto_scaling_enabled === true',
                          required: true
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              title: gettext('Network'),
              help: basePath + 'clusters/workflow/network.help.html',
              type: 'section',
              htmlClass: 'row',
              required: false,
              items: [
                {
                  type: 'section',
                  htmlClass: 'col-md-8',
                  items: [
                    {
                      type: 'fieldset',
                      title: gettext('Network'),
                      items: [
                        {
                          key: 'create_network',
                          title: gettext('Create New Network'),
                          onChange: function(isNewNetwork) {
                            // Reset relevant field selections
                            model.fixed_network = MODEL_DEFAULTS.fixed_network;
                            model.fixed_subnet = MODEL_DEFAULTS.fixed_subnet;
                            // Network tab has required fields based on this checkbox.
                            form[0].tabs[2].required = !isNewNetwork;
                          }
                        },
                        {
                          key: 'fixed_network',
                          type: 'select',
                          title: gettext('Use an Existing Network'),
                          titleMap: networkTitleMap,
                          condition: 'model.create_network === false',
                          required: true,
                          onChange: function () {
                            changeFixedNetwork(model);
                          }
                        },
                        {
                          key: 'fixed_subnet',
                          type: 'select',
                          title: gettext('Use an Existing Subnet'),
                          titleMap: subnetTitleMap,
                          condition: 'model.create_network === false',
                          required: true
                        }
                      ]
                    },
                    {
                      type: 'fieldset',
                      title: gettext('Kubernetes API Loadbalancer'),
                      items: [
                        {
                          key: 'master_lb_enabled',
                          type: 'checkbox',
                          title: gettext('Enable Load Balancer for Kubernetes API'),
                          onChange: function(value) {
                            if (value) {
                              model.master_count = MODEL_DEFAULTS.master_count;
                              // Reset values to defaults. They are null after being disabled.
                              model.master_lb_floating_ip_enabled =
                                MODEL_DEFAULTS.master_lb_floating_ip_enabled;
                              model.api_master_lb_allowed_cidrs =
                                MODEL_DEFAULTS.api_master_lb_allowed_cidrs;
                            } else {
                              // Without master_lb_enabled, we can only support
                              // a single master node.
                              model.master_count = 1;
                            }
                            model.isSingleMasterNode = !value;
                          }
                        },
                        {
                          key: 'master_lb_floating_ip_enabled', // formerly floating_ip_enabled
                          type: 'select',
                          title: gettext('Floating IP'),
                          titleMap: [
                            {value: false, name: gettext('Accessible on private network only')},
                            {value: true, name: gettext('Accessible with public floating IP')}
                          ],
                          condition: 'model.master_lb_enabled === true'
                        },
                        {
                          key: 'api_master_lb_allowed_cidrs',
                          type: 'text',
                          title: gettext('Allowed CIDRs'),
                          validationMessage: {
                            invalidFormat: gettext('Invalid format. Must be a comma-separated ' +
                              'CIDR string: 192.168.1.5/32,10.0.0.1/24')
                          },
                          $validators: {
                            invalidFormat: function(cidrString) {
                              return cidrString === '' || REGEXP_CIDR_LIST.test(cidrString);
                            }
                          },
                          condition: 'model.master_lb_enabled === true',
                        },
                        // Warning message when Kubernetes API has a Floating IP
                        {
                          type: 'template',
                          template: '<div class="alert alert-warning">' +
                            '<span class="fa fa-warning"></span> ' +
                            gettext('A public floating IP will mean the Kubernetes API is ' +
                              'publically routable on the internet. It is generally not ' +
                              'recommended to give public access to the Kubernetes API. ' +
                              'Consider limiting the access using the Allowed CIDRs ' +
                              'section.') +
                            '</div>',
                          condition: 'model.master_lb_floating_ip_enabled == true'
                        }
                      ]
                    },
                    {
                      type: 'fieldset',
                      title: gettext('Ingress'),
                      items: [
                        {
                          key: 'ingress_controller',
                          title: gettext('Ingress Controller'),
                          type: 'select',
                          titleMap: ingressTitleMap
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              title: gettext('Management'),
              help: basePath + 'clusters/workflow/management.help.html',
              type: 'section',
              htmlClass: 'row',
              items: [
                {
                  type: 'section',
                  htmlClass: 'col-md-8',
                  items: [
                    {
                      type: 'fieldset',
                      title: gettext('Auto Healing'),
                      items: [
                        {
                          key: 'auto_healing_enabled',
                          type: 'checkbox',
                          title: gettext('Automatically Repair Unhealthy Nodes')
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              title: gettext('Advanced'),
              help: basePath + 'clusters/workflow/advanced.help.html',
              type: 'section',
              htmlClass: 'row',
              items: [
                {
                  type: 'section',
                  htmlClass: 'col-md-8',
                  items: [
                    {
                      type: 'fieldset',
                      title: gettext('Labels'),
                      items: [
                        {
                          key: 'labels',
                          type: 'textarea',
                          title: gettext('Additional Labels'),
                          placeholder: gettext('key=value,key2=value2...'),
                          validationMessage: {
                            invalidFormat: gettext('Invalid format. Must be a comma-separated ' +
                              'key-value string: key=value,key2=value2')
                          },
                          $validators: {
                            invalidFormat: function(labelsString) {
                              return labelsString === '' || REGEXP_KEY_VALUE.test(labelsString);
                            }
                          },
                          disableSuccessState: true
                        },
                        {
                          key: 'override_labels',
                          type: 'checkbox',
                          title: gettext('I do want to override Template and Workflow Labels'),
                          condition: 'model.labels !== ""',
                        },
                        // Warning message for the label override
                        {
                          type: 'template',
                          template: '<div class="alert alert-warning">' +
                            '<span class="fa fa-warning"></span> ' +
                            gettext('Overriding labels already defined by the cluster ' +
                            'template or workflow might result in unpredictable ' +
                            'behaviour.') + '</div>',
                          condition: 'model.override_labels == true'
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ];

      function getModelDefaults() {
        return {
          // Props used by the form
          name: '',
          cluster_template_id: '',
          availability_zone: '',
          keypair: '',
          addons: [],

          master_count: null,
          master_flavor_id: '',
          node_count: null,
          flavor_id: '',
          auto_scaling_enabled: false,
          min_node_count: null,
          max_node_count: null,

          master_lb_enabled: false,
          create_network: true,
          fixed_network: '',
          fixed_subnet: '',
          master_lb_floating_ip_enabled: false,
          api_master_lb_allowed_cidrs: '',
          ingress_controller: '',

          auto_healing_enabled: true,
          labels: '',
          override_labels: false,

          // Utility properties (not actively used in the form,
          // populated dynamically)
          id: null,
          templateLabels: null,
          ingressControllers: null,
          isSingleMasterNode: false
        };
      }

      function autosetScalingModelValues() {
        var nodeCount = model.node_count;
        if (nodeCount && nodeCount > 0 && model.auto_scaling_enabled) {

          // Set defaults to related modal fields (have they not been changed)
          if (model.min_node_count === MODEL_DEFAULTS.min_node_count) {
            model.min_node_count = nodeCount > 1 ? nodeCount - 1 : 1;
          } else if (nodeCount < model.min_node_count) {
            model.min_node_count = nodeCount;
          }

          if (model.max_node_count === MODEL_DEFAULTS.max_node_count) {
            model.max_node_count = nodeCount + 1;
          } else if (nodeCount > model.max_node_count) {
            model.max_node_count = nodeCount;
          }
        }
      }

      function onGetKeypairs(response) {
        var items = response.data.items;

        angular.forEach(items, function(item) {
          keypairsTitleMap.push({
            value: item.keypair.name,
            name: item.keypair.name
          });
        });

        if (items.length === 1) {
          model.keypair = items[0].keypair.name;
        }
      }

      function onGetAvailabilityZones(response) {
        angular.forEach(response.data.items, function(availabilityZone) {
          availabilityZoneTitleMap.push({
            value: availabilityZone.zoneName,
            name: availabilityZone.zoneName
          });
        });

        setSingleItemAsDefault(response.data.items, 'availability_zone', 'zoneName');
      }

      function onGetAddons(response) {
        angular.forEach(response.data.addons, function(addon) {
          addonsTitleMap.push({ value: addon, name: addon.name });
          // Pre-selected by default
          if (addon.selected) { model.addons.push(addon); }
        });
      }

      function onGetFlavors(response) {
        angular.forEach(response.data.items, function(flavor) {
          workerFlavorTitleMap.push({value: flavor.name, name: flavor.name});
          masterFlavorTitleMap.push({value: flavor.name, name: flavor.name});
        });
      }

      function onGetClusterTemplates(response) {
        angular.forEach(response.data.items, function(clusterTemplate) {
          templateTitleMap.push({value: clusterTemplate.id, name: clusterTemplate.name});
        });
      }

      function onGetNetworks(response) {
        angular.forEach(response.data.items, function(network) {
          networkTitleMap.push({
            value: network.id,
            name: network.name + ' (' + network.id + ')',
            subnets: network.subnets
          });
        });

        setSingleItemAsDefault(response.data.items, 'fixed_network', 'id');
      }

      function changeFixedNetwork(model) {
        if (model.fixed_network) {
          subnetTitleMap = [{value: "", name: gettext("Choose an existing Subnet")}];
          angular.forEach(networkTitleMap, function(network) {
            if (network.value === model.fixed_network) {
              angular.forEach(network.subnets, function(subnet) {
                subnetTitleMap.push({value: subnet.id, name: subnet.name});
              });
            }
          });
        } else {
          fixedSubnets = [{value: "", name: fixedSubnetsInitial}];
        }
        // NOTE(dalees): This hardcoded index could be improved by referencing an object instead.
        form[0].tabs[2].items[0].items[0].items[2].titleMap = subnetTitleMap;
        model.fixed_subnet = MODEL_DEFAULTS.fixed_subnet;
      }

      function onGetIngressControllers(response) {
        angular.forEach(response.data.controllers, function(ingressController) {
          ingressTitleMap.push({value: ingressController, name: ingressController.name});
        });

        model.ingressControllers = response.data.controllers;

        // Set first item to defaults
        if (model.ingressControllers.length > 0) {
          model.ingress_controller = ingressTitleMap[1].value;
        }
      }

      function setSingleItemAsDefault(itemsList, modelKey, itemKey) {
        if (itemsList.length === 1) {
          model[modelKey] = itemsList[0][itemKey];
        }
      }

      $scope.$on('$destroy', function() {
        isSingleMasterNodeWatcher();
      });

      // Fetch all the dependencies from APIs and return Promise
      // with a form configuration object.
      return $q.all([
        magnum.getClusterTemplates().then(onGetClusterTemplates),
        nova.getAvailabilityZones().then(onGetAvailabilityZones),
        nova.getKeypairs().then(onGetKeypairs),
        neutron.getNetworks().then(onGetNetworks),
        magnum.getAddons().then(onGetAddons),
        nova.getFlavors(false, false).then(onGetFlavors),
        magnum.getIngressControllers().then(onGetIngressControllers)
      ]).then(function() {
        $scope.model = model;
        $scope.model.DEFAULTS = MODEL_DEFAULTS;

        // Modal Config
        return {
          title: title,
          schema: schema,
          form: form,
          model: model
        };
      });
    }

    return workflow;
  }

})();
