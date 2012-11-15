// graphite.js

function build_url(options) {
    var url = options.url + "?";

    // use random parameter to force image refresh
    options["_t"] = options["_t"] || Math.random();

    $.each(options, function (key, value) {
        if (key === "target") { // png
            $.each(value, function (index, value) {
                url += "&target=" + value;
            });
        } else if (key === "targets") { // rickshaw
            $.each(value, function (index, value) {
                    url += "&target=" + value.target;
            });
        } else if (value !== null && key !== "url") {
            url += "&" + key + "=" + value;
        }
    });

    url = url.replace(/\?&/, "?");
    return url;
};

function find_definition (target_graphite, options) {
    var matching_i = undefined;
    for (var cfg_i = 0; cfg_i < options.targets.length && matching_i == undefined; cfg_i++) {
        // alias in config
        // currently this is not needed because we don't actually send aliases to graphite (yet)
        if(options.targets[cfg_i].name != undefined && options.targets[cfg_i].name == target_graphite.target) {
            matching_i = cfg_i;
        }
        // string match (no globbing)
        else if(options.targets[cfg_i].target == target_graphite.target) {
            matching_i = cfg_i;
        }
        // glob match?
        else if(target_graphite.target.graphiteGlob(options.targets[cfg_i].target)) {
            matching_i = cfg_i;
        }
    }
    if (matching_i == undefined) {
        console.error ("internal error: could not figure out which target_option target_graphite '" +
                target_graphite.target + "' comes from");
        return [];
    }
    return options.targets[matching_i];
}

(function ($) {
    $.fn.graphite = function (options) {
        if (options === "update") {
            $.fn.graphite.update(this, arguments[1]);
            return this;
        }

        // Initialize plugin //
        options = options || {};
        var settings = $.extend({}, $.fn.graphite.defaults, options);

        return this.each(function () {
            $this = $(this);

            $this.data("graphOptions", settings);
            $.fn.graphite.render($this, settings);
        });

    };

    $.fn.graphite.render = function($img, options) {
        $img.attr("src", build_url(options));
        $img.attr("height", options.height);
        $img.attr("width", options.width);
    };

    $.fn.graphite.update = function($img, options) {
        options = options || {};
        $img.each(function () {
            $this = $(this);
            var settings = $.extend({}, $this.data("graphOptions"), options);
            $this.data("graphOptions", settings);
            $.fn.graphite.render($this, settings);
        });
    };

    // note: graphite json output is a list of dicts like:
    // {"datapoints": [...], "target": "<metricname>" }
    // if you did alias(series, "foo") then "target" will contain the alias
    // (loosing the metricname which is bad, esp. when you had a glob with an alias, then you don't know what's what)
    // rickshaw: options.series is a list of dicts like:
    // { name: "alias", color: "foo", data: [{x: (...), y: (...)} , ...]}
    // we basically tell users to use this dict, with extra 'target' to specify graphite target string
    $.fn.graphiteRick = function (options, on_error) {
        options = options || {};
        var settings = $.extend({}, $.fn.graphite.defaults, options);

        return this.each(function () {
            $this = $(this);

            $this.data("graphOptions", settings);
            $.fn.graphiteRick.render(this, settings, on_error);
        });
    };

    $.fn.graphiteRick.render = function(div, options, on_error) {
        $div = $(div);
        $div.attr("height", options.height);
        $div.attr("width", options.width);
        var drawRick = function(response) {
            // note that response.length can be != options.targets.length.  let's call:
            // * target_graphite a targetstring as returned by graphite
            // * target_option a targetstring configuration
            // if a target_option contains * graphite will return all matches separately unless you use something to aggregate like sumSeries()
            // we must render all target_graphite's, but we must merge in the config from the corresponding target_option.
            // example: for a target_graphite 'stats.foo.bar' we must find a target_option 'stats.foo.bar' *or*
            // anything that causes graphite to match it, such as 'stats.*.bar' (this would be a bit cleaner if graphite's json
            // would include also the originally specified target string)
            // note that this code assumes each target_graphite can only be originating from one target_option,
            // in some unlikely cases this is not correct (there might be overlap between different target_options with globs)
            // but in that case I don't see why taking the settings of any of the possible originating target_options wouldn't be fine.
            var all_targets = [];
            if(response.length == 0 ) {
                console.warn("no data in response");
            }
            for (var res_i = 0; res_i < response.length; res_i++) {
                var target = find_definition(response[res_i], options);
                target.data = [];
                for (var i in response[res_i].datapoints) {
                    target.data[i] = { x: response[res_i].datapoints[i][1], y: response[res_i].datapoints[i][0] || 0 };
                }
                all_targets.push(target);
            }
            var graph = new Rickshaw.Graph({
                element: div,
                height: options.height,
                width: options.width,
                series: all_targets
            });
            if(options['x_axis']) {
                var x_axis = new Rickshaw.Graph.Axis.Time( { graph: graph } );
            }
            if(options['y_axis']) {
                var y_axis = new Rickshaw.Graph.Axis.Y( {
                    graph: graph,
                    orientation: 'left',
                    tickFormat: Rickshaw.Fixtures.Number.formatKMBT,
                    element: document.getElementById(options['y_axis']),
                });
            }
            if(options['hoover_details']) {
                var hoverDetail = new Rickshaw.Graph.HoverDetail( {
                    graph: graph
                } );
            }
            graph.render();
            if (options['legend']) {
                var legend = new Rickshaw.Graph.Legend({
                    graph: graph,
                    element: document.getElementById(options['legend'])
                });
                if(options['legend.toggle']) {
                    var shelving = new Rickshaw.Graph.Behavior.Series.Toggle({
                        graph: graph,
                        legend: legend
                    });
                }
                if(options['legend.reorder']) {
                    var order = new Rickshaw.Graph.Behavior.Series.Order({
                        graph: graph,
                        legend: legend
                    });
                }
                if(options['legend.highlight']) {
                    var highlighter = new Rickshaw.Graph.Behavior.Series.Highlight({
                    graph: graph,
                    legend: legend
                    });
                }
            }
            if (options['line-stack-toggle']) {
                var form = document.getElementById(options['line-stack-toggle']);
                form.innerHTML= '<input type="radio" name="offset" id="lines" value="lines" checked>' +
                    '<label class="lines" for="lines">lines</label>' +
                    '<input type="radio" name="offset" id="stack" value="zero">' +
                    '<label class="stack" for="stack">stack</label>';

                form.addEventListener('change', function(e) {
                    var offsetMode = e.target.value;

                    if (offsetMode == 'lines') {
                        graph.setRenderer('line');
                        graph.offset = 'zero';
                    } else {
                        graph.setRenderer('stack');
                        graph.offset = offsetMode;
                    }
                    graph.render();
                }, false);
            }
        }
        $.ajax({
            accepts: {text: 'application/json'},
            cache: false,
            dataType: 'jsonp',
            jsonp: 'jsonp',
            url: build_url(options) + '&format=json',
            error: function(xhr, textStatus, errorThrown) { on_error(textStatus + ": " + errorThrown); }
          }).done(drawRick);
    };


    // Default settings. 
    // Override with the options argument for per-case setup
    // or set $.fn.graphite.defaults.<value> for global changes
    $.fn.graphite.defaults = {
        from: "-1hour",
        height: "300",
        until: "now",
        url: "/render/",
        width: "940"
    };

}(jQuery));
